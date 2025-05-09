import * as vscode from "vscode";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { marked } from "marked";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ReadmeViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("signpost", provider)
  );
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh())
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (/README\.md$/i.test(doc.fileName)) {
        provider.refresh();
      }
    })
  );
}

export function deactivate() {}

class ReadmeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    this.update();
  }

  public refresh() {
    this.update();
  }

  private update() {
    if (!this.view) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    let dir = editor
      ? dirname(editor.document.uri.fsPath)
      : vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
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

    const html = readme
      ? marked.parse(readFileSync(readme, "utf8"))
      : "<em>No README.md found</em>";

    this.view.webview.html = `<!DOCTYPE html>
      <html><body style="padding:10px;font-family:var(--vscode-font-family)">
        ${html}
      </body></html>`;
  }
}
