"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const GROUPS=[
  {title:"OPERATIONS",items:[
    {label:"Overview",href:"/app",glyph:"⌂"},
    {label:"Clients",href:"/app",glyph:"▦"},
    {label:"Devices",href:"/app/devices",glyph:"▣"},
    {label:"AI tools",href:"/app/tools",glyph:"◇"},
    {label:"People",href:"/app/people",glyph:"♙"},
    {label:"Scan file explorer",href:"/app/import",glyph:"◎"}
  ]},
  {title:"DEPLOY & MANAGE",items:[
    {label:"Scanner downloads",href:"/app/downloads",glyph:"⇩"},
    {label:"Team & settings",href:"/app/settings",glyph:"⚙"}
  ]},
  {title:"DEVELOPERS",items:[
    {label:"Zipax",href:"/app/zipax",glyph:"◈"},
    {label:"Team profile",href:"/app/zipax/team",glyph:"▤"}
  ]}
];
export function ConsoleNavigation({settingsVisible}:{settingsVisible:boolean}) {
  const path=usePathname();
  return <nav className="console-nav" aria-label="MSP console navigation">
    {GROUPS.map(group=><div className="console-nav-group" key={group.title}>
      <p className="console-nav-label">{group.title}</p>
      {group.items.filter(item=>settingsVisible || item.href!=="/app/settings").map(item=>{
        const active=item.href==="/app"?path==="/app":path===item.href||path.startsWith(item.href+"/");
        return <Link key={item.label} href={item.href} aria-current={active?"page":undefined}>
          <span className="console-nav-symbol" aria-hidden="true">{item.glyph}</span>{item.label}
        </Link>;
      })}
    </div>)}
  </nav>;
}