import { BellRingingIcon } from "@phosphor-icons/react";

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-kumo-brand text-white"
      style={{ width: size, height: size }}
    >
      <BellRingingIcon size={Math.round(size * 0.58)} weight="bold" />
    </span>
  );
}
