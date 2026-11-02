"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [{ href: "/home", label: "홈" }, { href: "/notes", label: "노트" }, { href: "/account", label: "계정" }];

export function Brand({ href = "/" }: { href?: string }) {
  return <Link className="brand" href={href} aria-label="Talkie 처음으로"><span className="brand-icon" aria-hidden="true">t</span>talkie<span className="brand-dot">.</span></Link>;
}

/** Signed-in navigation shared by the app pages. */
export function AppHeader() {
  const path = usePathname();
  return <header className="site-header app-header">
    <Brand href="/home" />
    <nav className="app-nav" aria-label="주요 메뉴">
      {links.map(link => <Link key={link.href} href={link.href} aria-current={path === link.href || path.startsWith(`${link.href}/`) ? "page" : undefined}>{link.label}</Link>)}
      <Link className="primary nav-start" href="/talk">대화하기 <span aria-hidden="true">↗</span></Link>
    </nav>
  </header>;
}

export function AppFooter() {
  return <footer className="site-footer"><span>Small conversations. Lasting progress.</span><span>Talkie · 로컬 데모</span></footer>;
}
