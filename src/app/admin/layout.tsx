export const metadata = { title: "Events team" };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  // The shell itself is rendered per-page, because the login page must not
  // show admin navigation. Auth is enforced by middleware plus requireAdmin()
  // at the top of every admin page.
  return children;
}
