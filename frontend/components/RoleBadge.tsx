import { AccessRole, User } from "@/lib/types";

const STYLES: Record<AccessRole, string> = {
  owner: "bg-blue-50 text-blue-800 border-blue-200",
  editor: "bg-slate-100 text-slate-700 border-slate-300",
  viewer: "bg-white text-slate-600 border-slate-200",
};

const LABELS: Record<AccessRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

/**
 * The signed-in user's role on a submission.
 *
 * The role comes from the API — the same value the server enforces against — so this
 * badge cannot claim access the user does not have.
 */
export function RoleBadge({ role, owner }: { role: AccessRole; owner: User | null }) {
  const sharedBy = role !== "owner" && owner ? ` · shared by ${owner.displayName}` : "";

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${STYLES[role]}`}
      title={`You are ${role === "owner" ? "the owner" : `a ${role}`}${sharedBy}`}
    >
      {LABELS[role]}
      {sharedBy && <span className="sr-only">{sharedBy}</span>}
    </span>
  );
}
