import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "@cloudflare/kumo";

/** Tooltip that uses its single child as the trigger element (no extra wrapper button). */
export function Tip({ content, children }: { content: ReactNode; children: ReactElement }) {
  return <Tooltip content={content} render={children} />;
}
