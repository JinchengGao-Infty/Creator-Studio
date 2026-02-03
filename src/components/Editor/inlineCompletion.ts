import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

export const setInlineCompletion = StateEffect.define<string>();
export const clearInlineCompletion = StateEffect.define<null>();

class InlineCompletionWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inline-completion";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

export const inlineCompletionField = StateField.define<string>({
  create() {
    return "";
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setInlineCompletion)) value = effect.value;
      if (effect.is(clearInlineCompletion)) value = "";
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const value = state.field(field);
      if (!value) return Decoration.none;

      const selection = state.selection.main;
      if (!selection.empty) return Decoration.none;

      const pos = selection.head;
      const deco = Decoration.widget({
        widget: new InlineCompletionWidget(value),
        side: 1,
      });
      return Decoration.set([deco.range(pos)]);
    }),
});

export function getInlineCompletion(state: EditorState): string {
  try {
    return state.field(inlineCompletionField);
  } catch {
    return "";
  }
}

export function acceptInlineCompletion(view: EditorView): boolean {
  const suggestion = getInlineCompletion(view.state);
  if (!suggestion) return false;
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const insert = suggestion;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length },
    effects: clearInlineCompletion.of(null),
  });
  return true;
}

export function clearInlineCompletionInView(view: EditorView) {
  view.dispatch({ effects: clearInlineCompletion.of(null) });
}

export const inlineCompletionTheme = EditorView.baseTheme({
  ".cm-inline-completion": {
    color: "var(--text-muted)",
    opacity: "0.65",
    whiteSpace: "pre",
  },
});
