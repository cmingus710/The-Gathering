import {
  BookUser,
  CalendarDays,
  ClipboardList,
  HandHeart,
  HandCoins,
  House,
  LayoutDashboard,
  Megaphone,
  PlayCircle,
  Settings,
  Sprout,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import type { IconName } from "@/lib/navigation";

const ICONS = {
  home: House,
  announcements: Megaphone,
  profile: UserRound,
  community: UsersRound,
  prayer: HandHeart,
  events: CalendarDays,
  grow: Sprout,
  media: PlayCircle,
  give: HandCoins,
  directory: BookUser,
  dashboard: LayoutDashboard,
  members: Users,
  settings: Settings,
  audit: ClipboardList,
} satisfies Record<IconName, unknown>;

export function NavIcon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
