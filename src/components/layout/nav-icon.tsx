import {
  Bell,
  BookUser,
  CalendarDays,
  ClipboardList,
  HandHeart,
  HandCoins,
  House,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  PlayCircle,
  Settings,
  ShieldAlert,
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
  community: MessagesSquare,
  groups: UsersRound,
  messages: MessageCircle,
  notifications: Bell,
  moderation: ShieldAlert,
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
