import * as vscode from "vscode";
import { existsSync, readFileSync, lstatSync } from "fs";
import { dirname, join } from "path";
import { marked } from "marked";
import dedent from "dedent";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ReadmeViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("signpost", provider)
  );

  // Clear override and schedule render when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      provider.clearOverride();
      provider.scheduleRender();
    })
  );

  // Refresh when a README is saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (/README\.md$/i.test(doc.fileName)) {
        provider.scheduleRender();
      }
    })
  );

  // Context-menu command to show a folder's README
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "signpost.showReadmeForResource",
      (resource: vscode.Uri) => {
        const dir = lstatSync(resource.fsPath).isDirectory()
          ? resource.fsPath
          : dirname(resource.fsPath);
        provider.setOverrideDir(dir);
        provider.scheduleRender();
      }
    )
  );
}

export function deactivate() {}

class ReadmeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private overrideDir?: string;
  private readmePath?: string;
  private updateTimer?: NodeJS.Timeout;

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    const rootUri = vscode.workspace.workspaceFolders?.[0].uri;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: rootUri ? [rootUri] : [],
    };
    view.webview.onDidReceiveMessage((msg) => {
      if (msg.command === "open" && this.readmePath) {
        vscode.commands.executeCommand(
          "vscode.open",
          vscode.Uri.file(this.readmePath)
        );
      }
    });
    this.scheduleRender();
  }

  public clearOverride() {
    this.overrideDir = undefined;
  }

  public setOverrideDir(dir: string) {
    this.overrideDir = dir;
  }

  public scheduleRender() {
    if (!this.view) return;
    clearTimeout(this.updateTimer!);
    this.updateTimer = setTimeout(() => this.updateContent(), 100);
  }

  private updateContent() {
    if (!this.view) return;

    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath || "";
    const startDir = this.overrideDir
      ? this.overrideDir
      : vscode.window.activeTextEditor
      ? dirname(vscode.window.activeTextEditor.document.uri.fsPath)
      : root;

    // Find nearest README.md file
    let dir = startDir;
    let readme: string | undefined;
    while (dir) {
      const p = join(dir, "README.md");
      if (existsSync(p)) {
        readme = p;
        break;
      }
      if (!root || dir === root) break;
      dir = dirname(dir);
    }
    this.readmePath = readme;

    // Read Markdown content
    const md = readme ? readFileSync(readme, "utf8") : "";

    // Setup custom renderer to handle local images
    const renderer = new marked.Renderer();
    renderer.image = (
      hrefOrToken: any,
      title?: any,
      text?: any,
      tokens?: any
    ) => {
      // Normalize arguments for both signature versions
      let href: string;
      let imgTitle: string | null = null;
      let altText: string;
      if (
        text === undefined &&
        title === undefined &&
        hrefOrToken &&
        hrefOrToken.href
      ) {
        // new signature: token object passed
        href = hrefOrToken.href;
        imgTitle = hrefOrToken.title || null;
        altText = hrefOrToken.text;
      } else {
        // old signature: href, title, text
        href = hrefOrToken;
        imgTitle = title || null;
        altText = text!;
      }
      if (!href || !this.view || !readme) {
        return `<img src=\"${href}\" alt=\"${altText}\" />`;
      }
      if (/^(https?:)?\/\//.test(href) || href.startsWith("data:")) {
        const titleAttr = imgTitle ? ` title="${imgTitle}"` : "";
        return `<img src="${href}" alt="${altText}"${titleAttr} />`;
      }

      // Resolve image path relative to the README location
      const imgPath = join(dirname(readme), href);
      const imgUri = vscode.Uri.file(imgPath);
      const webviewUri = this.view.webview.asWebviewUri(imgUri);
      const titleAttr = imgTitle ? ` title=\"${imgTitle}\"` : "";
      return `<img src=\"${webviewUri}\" alt=\"${altText}\"${titleAttr} />`;
    };

    // Convert Markdown to HTML with the custom renderer
    const contentHtml = readme
      ? marked.parse(md, { renderer })
      : "<em>No README.md found</em>";

    // Short path for display
    const readmeShortPath = this.readmePath?.split(/[\\/]/).slice(-2).join("/");

    // Open link button
    const openButton = readme
      ? `<a class=\"open-btn\" href=\"#\" onclick=\"openReadme()\" title=\"Open README.md\">${readmeShortPath}</a>`
      : "";

    // Render the webview HTML
    this.view.webview.html = dedent`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset='UTF-8'>
          <style>
            body {
              position: relative;
              margin: 0;
              padding: 10px;
              font-family: var(--vscode-font-family);
            }

            .open-btn {
              background: transparent;
              color: var(--vscode-textLink-foreground);
              opacity: 0.6;
              text-decoration: none;
              font-size: 0.9rem;
              transition: opacity 0.2s;
            }

            .open-btn:hover {
              opacity: 1;
            }

            .content {
              margin: 0;
            }
          </style>
        </head>
        <body>
          ${openButton}
          <div class="content">${contentHtml}</div>
          <script>
            const vscode = acquireVsCodeApi();
            function openReadme() {
              vscode.postMessage({ command: 'open' });
            }
          </script>
        </body>
      </html>
    `;
  }
}
