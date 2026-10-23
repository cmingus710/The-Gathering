import { Spinner } from "@/components/ui/spinner";

export default function GalleryLoading() {
  return (
    <div role="status" className="flex items-center gap-3 py-16 text-text-secondary">
      <Spinner />
      <span>Loading the Media gallery…</span>
    </div>
  );
}
