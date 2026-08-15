import {
  ArchiveIcon,
  BanIcon,
  ClockIcon,
  KeyRoundIcon,
  SlashIcon,
  TagIcon,
  TagsIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  PublicVehicleBadge,
  VehiclePublicState,
} from "@/lib/vehicle-public-state";

/**
 * Accessible public status badge.
 *
 * It consumes only the centralized {@link VehiclePublicState} and never derives
 * commercial rules itself. Status is conveyed by an always-present text label
 * and an icon, so it is never communicated by color alone.
 */

interface BadgeStyle {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly variant: "default" | "secondary" | "outline" | "destructive";
  readonly className?: string;
}

const BADGE_STYLES: Record<PublicVehicleBadge, BadgeStyle> = {
  "for-sale": { label: "For sale", icon: TagIcon, variant: "default" },
  "for-rent": { label: "For rent", icon: KeyRoundIcon, variant: "default" },
  "for-sale-and-rent": {
    label: "Sale & rent",
    icon: TagsIcon,
    variant: "default",
  },
  reserved: { label: "Reserved", icon: ClockIcon, variant: "secondary" },
  sold: { label: "Sold", icon: BanIcon, variant: "secondary" },
  retired: {
    label: "No longer available",
    icon: ArchiveIcon,
    variant: "outline",
  },
  unavailable: {
    label: "Unavailable",
    icon: SlashIcon,
    variant: "outline",
  },
};

export function VehicleStatusBadge({
  presentation,
  className,
}: {
  presentation: Pick<VehiclePublicState, "badge">;
  className?: string;
}) {
  const style = BADGE_STYLES[presentation.badge];
  const Icon = style.icon;
  return (
    <Badge variant={style.variant} className={cn(style.className, className)}>
      <Icon aria-hidden="true" />
      {style.label}
    </Badge>
  );
}
