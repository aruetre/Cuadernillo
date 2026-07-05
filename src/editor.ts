import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { indent } from "@milkdown/kit/plugin/indent";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { replaceAll } from "@milkdown/kit/utils";

export type OnChange = (markdown: string) => void;

let editor: Editor | null = null;
let suppress = false;

export async function createEditor(mount: string, onChange: OnChange): Promise<void> {
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, mount);
      ctx.set(defaultValueCtx, "");
      ctx.get(listenerCtx).markdownUpdated((_ctx, md, prev) => {
        if (suppress || md === prev) return;
        onChange(md);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(indent)
    .use(listener)
    .create();
}

export function setContent(markdown: string): void {
  if (!editor) return;
  suppress = true;
  editor.action(replaceAll(markdown, true));
  // El listener se dispara de forma asíncrona; liberamos en el siguiente tick largo.
  setTimeout(() => { suppress = false; }, 50);
}

export function focusEditor(): void {
  const pm = document.querySelector<HTMLElement>("#editor .ProseMirror");
  pm?.focus();
}
