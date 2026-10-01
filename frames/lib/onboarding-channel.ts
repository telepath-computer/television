// A channel's manifest supplies every page. The existing stage rig handles
// sizing/full-screen; this small wrapper adds selection without remounting the
// artifact iframes, so their component state survives a tab change.
import { channels } from "./onboarding";
import { stagePrototype } from "./stage";

/** Wire one manifest-backed channel, returning all listener cleanup. */
export const onboardingChannel = (host: HTMLElement): (() => void) => {
  const channel = channels[host.dataset.channel ?? ""];
  if (!channel) throw new Error(`Unknown onboarding channel: ${host.dataset.channel}`);
  const pages = [...host.querySelectorAll<HTMLElement>(".page")];
  const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  if (pages.length !== channel.pages.length || tabs.length !== pages.length) {
    throw new Error("Onboarding channel composition must contain one page and tab per manifest entry");
  }

  // The stage pose has a single full-screen selector; initial page geometry
  // belongs to every page. Apply each manifest value before the existing rig
  // computes the viewport's rendered sizes.
  pages.forEach((page, index) => {
    const { geometry, width, height } = channel.pages[index];
    page.toggleAttribute("full-screen", geometry.full_screen);
    page.dataset.width = String(width);
    page.dataset.height = String(height);
  });
  const disposeStage = stagePrototype(host);

  const select = (index: number) => {
    const selectedPage = pages[index];
    if (!selectedPage) return;
    pages.forEach((page, pageIndex) => page.toggleAttribute("selected", pageIndex === index));
    tabs.forEach((tab, tabIndex) => {
      tab.setAttribute("aria-selected", String(tabIndex === index));
      tab.tabIndex = tabIndex === index ? 0 : -1;
    });
    const filmstrip = host.querySelector<HTMLElement>(".filmstrip");
    if (filmstrip) {
      filmstrip.scrollLeft = selectedPage.offsetLeft + selectedPage.offsetWidth / 2 - filmstrip.clientWidth / 2;
    }
    tabs[index].scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[role="tab"]');
    const page = target.closest<HTMLElement>(".page:not([selected])");
    if (tab && host.contains(tab)) select(tabs.indexOf(tab));
    else if (page && host.contains(page)) select(pages.indexOf(page));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    select(next);
    tabs[next].focus();
  };
  host.addEventListener("click", onClick);
  host.addEventListener("keydown", onKeyDown);
  return () => {
    host.removeEventListener("click", onClick);
    host.removeEventListener("keydown", onKeyDown);
    disposeStage();
  };
};
