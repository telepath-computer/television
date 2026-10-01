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
