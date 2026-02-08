// ── Source location metadata ──────────────────────────────────────────

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface ComponentInfo {
  name: string;
  location: SourceLocation | null;
}

// ── Grabbed context payload ──────────────────────────────────────────

export interface GrabbedContext {
  /** The DOM element that was clicked */
  element: HTMLElement;
  /** Tag name of the element */
  tagName: string;
  /** Source location of the clicked element's JSX */
  elementSource: SourceLocation | null;
  /** Component ancestry chain, innermost first */
  components: ComponentInfo[];
  /** Formatted string ready for an AI agent prompt */
  formatted: string;
  /** Timestamp */
  timestamp: number;
}

// ── Configuration ────────────────────────────────────────────────────

export interface SolidGrabOptions {
  /**
   * Key to hold while hovering to activate the overlay.
   * @default "Alt"
   */
  key?: "Alt" | "Control" | "Meta" | "Shift";

  /**
   * Callback fired when an element is grabbed.
   * Return `false` to prevent the default clipboard copy.
   */
  onGrab?: (context: GrabbedContext) => void | false;

  /**
   * WebSocket URL for agent bridge.
   * If provided, grabbed context is also sent over WS.
   * @default undefined
   */
  agentUrl?: string;

  /**
   * Whether to show a toast notification on copy.
   * @default true
   */
  showToast?: boolean;
}

// ── Vite plugin options ──────────────────────────────────────────────

export interface SolidGrabPluginOptions {
  /**
   * Inject `data-solid-source` attributes into JSX elements.
   * @default true
   */
  jsxLocation?: boolean;

  /**
   * Inject `data-solid-component` attributes onto component root elements.
   * @default true
   */
  componentLocation?: boolean;

  /**
   * Auto-import the solid-grab runtime in dev mode.
   * @default true
   */
  autoImport?: boolean;
}

// ── Data attribute names ─────────────────────────────────────────────

export const ATTR_SOURCE = "data-solid-source";
export const ATTR_COMPONENT = "data-solid-component";
