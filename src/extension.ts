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

  // Clear any manual override and schedule render on editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      provider.clearOverride();
      provider.scheduleRender();
    })
  );

  // Refresh on saving a README
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
    view.webview.options = { enableScripts: true };
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

  // Debounced render to prevent flicker
  public scheduleRender() {
    if (!this.view) {
      return;
    }
    clearTimeout(this.updateTimer!);
    this.updateTimer = setTimeout(() => this.updateContent(), 100);
  }

  private updateContent() {
    if (!this.view) {
      return;
    }

    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    let dir = this.overrideDir
      ? this.overrideDir
      : vscode.window.activeTextEditor
      ? dirname(vscode.window.activeTextEditor.document.uri.fsPath)
      : root;

    let readme: string | undefined;
    while (dir) {
      const p = join(dir, "README.md");
      if (existsSync(p)) {
        readme = p;
        break;
      }
      if (!root || dir === root) {
        break;
      }

      dir = dirname(dir);
    }

    this.readmePath = readme;
    const contentHtml = readme
      ? marked.parse(readFileSync(readme, "utf8"))
      : "<em>No README.md found</em>";

    const readmeShortPath = this.readmePath?.split("/").slice(-2).join("/");

    const openButton = readme
      ? `<a class="open-btn" href="#" onclick="openReadme()" title="Open README.md">${readmeShortPath}</a>`
      : "";

    this.view.webview.html = dedent`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { position: relative; margin: 0; padding: 10px; font-family: var(--vscode-font-family); }
          .open-btn {
            background: transparent; color: var(--vscode-textLink-foreground);
            opacity: 0.6; padding: 2px 4px; border-radius: 2px;
            text-decoration: none; font-size: 0.9rem; transition: opacity 0.2s;
          }
          .open-btn:hover { opacity: 1; }
          .content { margin: 0; }
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
