import { useState } from 'react';
import { Bell, Boxes, CircleUserRound, Home, Settings, ShieldCheck, Users } from 'lucide-react';
import Scanner from './features/scanner/Scanner';

type Tab = 'Home' | 'Scan' | 'Inventory' | 'Alerts' | 'Family' | 'Settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('Scan');
  const nav: {name: Tab; icon: typeof Home}[] = [
    {name:'Home',icon:Home},{name:'Scan',icon:ShieldCheck},{name:'Inventory',icon:Boxes},
    {name:'Alerts',icon:Bell},{name:'Family',icon:Users},{name:'Settings',icon:Settings}
  ];
  return <div className="app-shell">
    <header className="topbar"><div><div className="eyebrow">PHOTOGRAPH · RECOGNISE · TRACK</div><h1>Scan to Safe</h1></div><button className="profile" aria-label="Profile"><CircleUserRound/></button></header>
    <main>
      <section className="hero"><div><div className="eyebrow">YOUR PRODUCTS, UNDER CONTROL</div><h2>{tab === 'Scan' ? 'What would you like to scan?' : tab}</h2><p>Capture product labels, recognise expiry information and keep your inventory organised.</p></div><div className="hero-mark">✓</div></section>
      {tab === 'Scan' && <Scanner/>}
      {tab === 'Home' && <section className="panel"><h2>Welcome to Scan to Safe</h2><p>Your dashboard will show total products, products expiring soon, expired products and recent activity once inventory is connected.</p><button className="primary" onClick={()=>setTab('Scan')}>Start scanning</button></section>}
      {tab === 'Inventory' && <section className="panel"><h2>Your inventory</h2><p>Product records and batch-wise expiry tracking will appear here after the scanner review and database are connected.</p></section>}
      {tab === 'Alerts' && <section className="panel"><h2>Expiry alerts</h2><p>Scheduled reminders will be configured after the inventory database and notification service are connected.</p></section>}
      {tab === 'Family' && <section className="panel"><h2>Family inventory</h2><p>Shared household access and member permissions will be added after account foundations.</p></section>}
      {tab === 'Settings' && <section className="panel"><h2>Account and preferences</h2><p>Authentication, language selection, accessibility and notification preferences are planned for the next foundation steps.</p></section>}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation">{nav.map(({name,icon:Icon})=><button key={name} className={tab===name?'active':''} onClick={()=>setTab(name)}><Icon size={19}/><span>{name}</span></button>)}</nav>
  </div>;
}
