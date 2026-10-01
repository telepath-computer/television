import "./checkbox-list.css";

/** A static authored checklist container; rendering remains in its light DOM. */
export class CheckboxListElement extends HTMLElement {}

/** A static authored checklist row; `checked` is styling state, not a control. */
export class CheckboxItemElement extends HTMLElement {}

if (!customElements.get("checkbox-list")) {
  customElements.define("checkbox-list", CheckboxListElement);
}

if (!customElements.get("checkbox-item")) {
  customElements.define("checkbox-item", CheckboxItemElement);
}
