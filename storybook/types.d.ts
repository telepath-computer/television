declare module "*.liquid" {
  interface LiquidParam {
    name: string;
    type: string;
    optional: boolean;
    description: string;
  }
  interface LiquidRendering {
    markup: string;
    styles: string[];
  }
  const render: ((data?: Record<string, unknown>) => LiquidRendering) & { params: LiquidParam[] };
  export default render;
}

declare module "*.yml" {
  const data: Record<string, unknown>;
  export default data;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}

// Swiper's CSS subpath exports (side-effect imports; Vite injects the styles).
declare module "swiper/css";
declare module "swiper/css/navigation";
declare module "swiper/css/pagination";
