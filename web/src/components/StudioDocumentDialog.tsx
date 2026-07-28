import { useMemo, useState } from "react";
import type { ElementDetail, TreeNode } from "../model/types";
import type { Selection } from "./Tree";

type Props = {
  selection: Selection;
  details: Record<string, ElementDetail>;
  tree: TreeNode[];
  onClose: () => void;
};

const APP_SETTINGS_TABS = ["Configurations", "Runtime", "Languages", "Certificates", "Model", "Workflows"];
const APP_SECURITY_TABS = [
  "Security level", "Module status", "User roles", "Administrator",
  "Demo users", "Anonymous users", "Password policy",
];
const MODULE_SECURITY_TABS = [
  "Module roles", "Page access", "Microflow access", "Nanoflow access",
  "Workflow access", "Entity access", "OData/GraphQL access", "REST access", "Data set access",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="studio-field"><span>{label}</span>{children}</label>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="studio-toggle"><input type="checkbox" checked={checked}
    onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function Matrix({
  title, rows, columns,
}: { title: string; rows: string[]; columns: string[] }) {
  return (
    <div className="studio-matrix-wrap">
      <div className="studio-section-title">{title}</div>
      <table className="studio-matrix">
        <thead><tr><th>Name</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={columns.length + 1} className="studio-empty">No items in this module.</td></tr>
            : rows.map((row) => <tr key={row}><td>{row}</td>{columns.map((column) =>
                <td key={column}><input type="checkbox" aria-label={`${row}: ${column}`} /></td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function AppSettings({ active }: { active: string }) {
  const [config, setConfig] = useState("Default");
  const [language, setLanguage] = useState("English, United States");
  const [bundleWidgets, setBundleWidgets] = useState(false);
  const [staticResources, setStaticResources] = useState(false);
  const [runtimeStatistics, setRuntimeStatistics] = useState(true);
  const [multipleSessions, setMultipleSessions] = useState(true);
  const [storageOptimization, setStorageOptimization] = useState(false);
  if (active === "Configurations") return (
    <>
      <div className="studio-toolbar"><button>New…</button><button>Duplicate…</button><button disabled>Delete</button></div>
      <div className="studio-split-list">
        <div className="studio-list"><button className="selected">Default</button></div>
        <div className="studio-form">
          <Field label="Name"><input value={config} onChange={(event) => setConfig(event.target.value)} /></Field>
          <div className="studio-section-title">Server</div>
          <Field label="Database"><select><option>Built-in database</option><option>PostgreSQL</option></select></Field>
          <Field label="HTTP port"><input type="number" defaultValue={8080} /></Field>
          <Field label="Admin port"><input type="number" defaultValue={8090} /></Field>
          <div className="studio-section-title">Constant values</div>
          <div className="studio-empty-box">No constant overrides in this configuration.</div>
        </div>
      </div>
    </>
  );
  if (active === "Runtime") return (
    <div className="studio-form">
      <Toggle checked={bundleWidgets} onChange={setBundleWidgets} label="Bundle widgets when running from Studio Pro" />
      <Toggle checked={staticResources} onChange={setStaticResources} label="Static resources from disk" />
      <Toggle checked={runtimeStatistics} onChange={setRuntimeStatistics} label="Enable runtime statistics" />
      <Field label="After startup"><div className="studio-picker"><input placeholder="(none)" /><button>…</button></div></Field>
      <Field label="Before shutdown"><div className="studio-picker"><input placeholder="(none)" /><button>…</button></div></Field>
      <Field label="Hash algorithm"><select><option>BCrypt</option><option>SHA-256</option></select></Field>
    </div>
  );
  if (active === "Languages") return (
    <>
      <Field label="Default language"><select value={language} onChange={(event) => setLanguage(event.target.value)}>
        <option>English, United States</option><option>Portuguese, Brazil</option><option>Spanish</option>
      </select></Field>
      <div className="studio-toolbar"><button>Add…</button><button>Edit…</button><button>Delete</button></div>
      <table className="studio-table"><thead><tr><th>Language</th><th>Code</th><th>Check completeness</th></tr></thead>
        <tbody><tr><td>{language}</td><td>en_US</td><td>Yes</td></tr></tbody></table>
    </>
  );
  if (active === "Certificates") return (
    <>
      <p className="studio-help">Certificates trusted by the runtime when connecting to HTTPS services.</p>
      <div className="studio-toolbar"><button>Add…</button><button>Import…</button><button disabled>Delete</button></div>
      <div className="studio-empty-box">No certificates configured.</div>
    </>
  );
  if (active === "Model") return (
    <div className="studio-form">
      <Field label="Java version"><select><option>Java 21</option><option>Java 17</option></select></Field>
      <Field label="Time zone"><select><option>Default</option><option>UTC</option></select></Field>
      <Toggle checked={multipleSessions} onChange={setMultipleSessions} label="Allow multiple active sessions per user" />
      <Toggle checked={storageOptimization} onChange={setStorageOptimization} label="Enable data storage optimization" />
    </div>
  );
  return (
    <div className="studio-form">
      <Field label="Workflow user entity"><div className="studio-picker"><input placeholder="System.User" /><button>…</button></div></Field>
      <Field label="Workflow admin page"><div className="studio-picker"><input placeholder="(none)" /><button>…</button></div></Field>
    </div>
  );
}

function AppSecurity({ active, detail, modules }: { active: string; detail?: ElementDetail; modules: TreeNode[] }) {
  const settings = (detail?.settings ?? {}) as Record<string, unknown>;
  const [level, setLevel] = useState(String(settings.SecurityLevel ?? "Off"));
  const [check, setCheck] = useState(Boolean(settings.CheckSecurity ?? true));
  const [strict, setStrict] = useState(Boolean(settings.StrictMode ?? false));
  const [demoUsers, setDemoUsers] = useState(Boolean(settings.DemoUsersEnabled));
  const [guestAccess, setGuestAccess] = useState(Boolean(settings.GuestAccess));
  const [adminUser, setAdminUser] = useState(String(settings.AdminUser ?? "MxAdmin"));
  const [adminPassword, setAdminPassword] = useState("");
  const [adminRole, setAdminRole] = useState("Administrator");
  const [minimumLength, setMinimumLength] = useState(Number(settings["PasswordPolicy.MinimumLength"] ?? 12));
  const [requireDigit, setRequireDigit] = useState(Boolean(settings["PasswordPolicy.RequireDigit"]));
  const [requireMixedCase, setRequireMixedCase] = useState(Boolean(settings["PasswordPolicy.RequireMixedCase"]));
  const [requireSymbol, setRequireSymbol] = useState(Boolean(settings["PasswordPolicy.RequireSymbol"]));
  if (active === "Security level") return (
    <div className="studio-form">
      <div className="studio-section-title">Security level</div>
      {["Off", "Prototype/demo", "Production"].map((value) =>
        <label className="studio-radio" key={value}><input type="radio" name="security-level"
          checked={level === value} onChange={() => setLevel(value)} /><span><strong>{value}</strong>
          <small>{value === "Production" ? "Full page, microflow and data security." :
            value === "Prototype/demo" ? "Authentication and document access without entity access." :
            "No security; intended only for local development."}</small></span></label>)}
      <div className="studio-section-title">Security checks</div>
      <Toggle checked={check} onChange={setCheck} label="Check security" />
      <Toggle checked={strict} onChange={setStrict} label="Strict page URL checking / strict mode" />
      <div className={`studio-status ${level === "Production" ? "warning" : ""}`}>
        App status: <strong>{level === "Production" ? "Incomplete" : "Complete"}</strong>
      </div>
    </div>
  );
  if (active === "Module status") return (
    <table className="studio-table"><thead><tr><th>Module</th><th>Pages</th><th>Microflows</th><th>Entities</th><th>Status</th></tr></thead>
      <tbody>{modules.map((module) => <tr key={module.label}><td>{module.label}</td>
        <td>—</td><td>—</td><td>—</td><td><span className="studio-ok">Complete</span></td></tr>)}</tbody></table>
  );
  if (active === "User roles") return (
    <>
      <div className="studio-toolbar"><button>New…</button><button>Edit…</button><button>Delete</button></div>
      <table className="studio-table"><thead><tr><th>Name</th><th>Module roles</th><th>Check security</th></tr></thead>
        <tbody><tr><td><input defaultValue="Administrator" /></td>
          <td><input defaultValue="Administration.Administrator, MyFirstModule.User" /></td>
          <td><input type="checkbox" defaultChecked /></td></tr>
          <tr><td><input defaultValue="User" /></td><td><input defaultValue="Administration.User, MyFirstModule.User" /></td>
            <td><input type="checkbox" defaultChecked /></td></tr></tbody></table>
    </>
  );
  if (active === "Administrator") return (
    <div className="studio-form"><Field label="User name"><input value={adminUser} onChange={(event) => setAdminUser(event.target.value)} /></Field>
      <Field label="Password"><input type="password" value={adminPassword}
        placeholder="Leave empty to keep the current password" onChange={(event) => setAdminPassword(event.target.value)} /></Field>
      <Field label="User role"><select value={adminRole} onChange={(event) => setAdminRole(event.target.value)}>
        <option>Administrator</option><option>User</option></select></Field></div>
  );
  if (active === "Demo users") return (
    <><Toggle checked={demoUsers} onChange={setDemoUsers} label="Enable demo users" />
      <div className="studio-toolbar"><button>New…</button><button>Edit…</button><button>Delete</button></div>
      <table className="studio-table"><thead><tr><th>User name</th><th>User role</th><th>Entity</th></tr></thead>
        <tbody><tr><td><input defaultValue="admin" /></td><td><select defaultValue="Administrator"><option>Administrator</option><option>User</option></select></td>
          <td><input defaultValue="Administration.Account" /></td></tr>
          <tr><td><input defaultValue="user" /></td><td><select defaultValue="User"><option>Administrator</option><option>User</option></select></td>
          <td><input defaultValue="Administration.Account" /></td></tr></tbody></table></>
  );
  if (active === "Anonymous users") return (
    <div className="studio-form"><Toggle checked={guestAccess} onChange={setGuestAccess} label="Allow anonymous users" />
      <Field label="Anonymous role"><select><option>(none)</option><option>User</option></select></Field></div>
  );
  return (
    <div className="studio-form">
      <Field label="Minimum length"><input type="number" min={1} value={minimumLength}
        onChange={(event) => setMinimumLength(Number(event.target.value))} /></Field>
      <Toggle checked={requireDigit} onChange={setRequireDigit} label="Require digit" />
      <Toggle checked={requireMixedCase} onChange={setRequireMixedCase} label="Require mixed case" />
      <Toggle checked={requireSymbol} onChange={setRequireSymbol} label="Require symbol" />
    </div>
  );
}

function ModuleSettings({ moduleName, active }: { moduleName: string; active: string }) {
  const [name, setName] = useState(moduleName);
  const [moduleType, setModuleType] = useState("App module");
  const [version, setVersion] = useState("1.0.0");
  const [moduleId, setModuleId] = useState("Assigned automatically");
  const [includeDocumentation, setIncludeDocumentation] = useState(true);
  const [protectContents, setProtectContents] = useState(false);
  if (active === "Java dependencies") return (
    <><div className="studio-toolbar"><button>Add dependency…</button><button>Synchronize</button><button>Delete</button></div>
      <table className="studio-table"><thead><tr><th>Group ID</th><th>Artifact ID</th><th>Version</th><th>Exclusions</th></tr></thead>
        <tbody><tr><td colSpan={4} className="studio-empty">No managed Java dependencies.</td></tr></tbody></table></>
  );
  if (active === "Export") return (
    <div className="studio-form"><Field label="Package name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Toggle checked={includeDocumentation} onChange={setIncludeDocumentation} label="Include documentation" />
      <Toggle checked={protectContents} onChange={setProtectContents} label="Protect module contents" /></div>
  );
  return (
    <div className="studio-form"><Field label="Module name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Module type"><select value={moduleType} onChange={(event) => setModuleType(event.target.value)}>
        <option>App module</option><option>Add-on module</option><option>Solution module</option></select></Field>
      <Field label="Version"><input value={version} onChange={(event) => setVersion(event.target.value)} /></Field>
      <Field label="Module ID"><div className="studio-picker"><input value={moduleId}
        onChange={(event) => setModuleId(event.target.value)} /><button onClick={() => setModuleId("")}>Override…</button></div></Field></div>
  );
}

function ModuleSecurity({ active, module }: { active: string; module?: TreeNode }) {
  const roles = (module?.children?.find((child) => child.type === "security")?.children ?? []).map((role) => role.label);
  const pages = (module?.children ?? []).flatMap(function walk(node): TreeNode[] {
    return [node, ...(node.children ?? []).flatMap(walk)];
  }).filter((node) => node.type === "page").map((node) => node.label);
  const flows = (module?.children ?? []).flatMap(function walk(node): TreeNode[] {
    return [node, ...(node.children ?? []).flatMap(walk)];
  }).filter((node) => node.type === (active === "Nanoflow access" ? "nanoflow" : "microflow")).map((node) => node.label);
  if (active === "Module roles") return (
    <><div className="studio-toolbar"><button>New…</button><button>Edit…</button><button>Delete</button></div>
      <table className="studio-table"><thead><tr><th>Name</th><th>Documentation</th><th>Included in user roles</th></tr></thead>
        <tbody>{roles.map((role) => <tr key={role}><td><input defaultValue={role} /></td>
          <td><input placeholder="Documentation" /></td><td><input placeholder="Select user roles…" /></td></tr>)}</tbody></table></>
  );
  if (active === "Page access") return <Matrix title="Page access" rows={pages} columns={roles} />;
  if (active === "Microflow access" || active === "Nanoflow access")
    return <Matrix title={active} rows={flows} columns={roles} />;
  if (active === "Entity access")
    return <Matrix title="Entity access rules" rows={(module?.children?.find((n) => n.type === "domainmodel")?.children ?? [])
      .filter((n) => n.type === "entity").map((n) => n.label)} columns={["Create", "Read", "Write", "Delete"]} />;
  return <Matrix title={active} rows={[]} columns={roles} />;
}

function NavigationEditor() {
  const [profiles, setProfiles] = useState(["Responsive web", "Tablet web", "Phone web", "Native mobile", "Embedded"]);
  const [profile, setProfile] = useState("Responsive web");
  const [homePage, setHomePage] = useState("MyFirstModule.Home_Web");
  const [menuItems, setMenuItems] = useState([{ caption: "Home", target: "MyFirstModule.Home_Web" }]);
  return (
    <div className="navigation-editor">
      <div className="navigation-profiles"><div className="studio-section-title">Profiles</div>
        {profiles.map((item) =>
          <button key={item} className={profile === item ? "selected" : ""} onClick={() => setProfile(item)}>{item}</button>)}
        <button className="studio-add" onClick={() => {
          const name = window.prompt("Profile name:");
          if (name?.trim()) { setProfiles((current) => [...current, name.trim()]); setProfile(name.trim()); }
        }}>＋ Add profile</button>
      </div>
      <div className="navigation-content">
        <div className="studio-section-title">{profile}</div>
        <Field label="Home page"><div className="studio-picker"><input value={homePage}
          onChange={(event) => setHomePage(event.target.value)} /><button>…</button></div></Field>
        <div className="studio-section-title">Role-based home pages</div>
        <div className="studio-empty-box">No role-based home pages configured.</div>
        <div className="studio-section-title">Menu</div>
        {menuItems.map((item, index) => <div className="navigation-menu-item" key={index}><span>☰</span>
          <input value={item.caption} onChange={(event) => setMenuItems((current) =>
            current.map((entry, itemIndex) => itemIndex === index ? { ...entry, caption: event.target.value } : entry))} />
          <input value={item.target} onChange={(event) => setMenuItems((current) =>
            current.map((entry, itemIndex) => itemIndex === index ? { ...entry, target: event.target.value } : entry))} />
          <button>…</button></div>)}
        <button className="studio-add" onClick={() => setMenuItems((current) =>
          [...current, { caption: "New item", target: "" }])}>＋ Add menu item</button>
      </div>
    </div>
  );
}

function StylingEditor() {
  return (
    <div className="styling-editor">
      <div className="studio-card"><strong>Web styling</strong><p>Theme, design properties and web resources.</p>
        <Field label="Theme module"><select><option>Atlas_Core</option></select></Field>
        <button>Open theme folder</button></div>
      <div className="studio-card"><strong>Native mobile styling</strong><p>Native theme and JavaScript styling resources.</p>
        <button>Open native theme folder</button></div>
      <div className="studio-card"><strong>Design properties</strong><p>Reusable design-time styling choices exposed to page editors.</p>
        <button>Manage design properties…</button></div>
    </div>
  );
}

export default function StudioDocumentDialog({ selection, details, tree, onClose }: Props) {
  const kind = selection.type;
  const moduleName = selection.qn.split(".")[0];
  const modules = tree.filter((node) => node.type === "module");
  const module = modules.find((node) => node.label === moduleName);
  const tabs = useMemo(() => {
    if (kind === "settings") return APP_SETTINGS_TABS;
    if (kind === "projectsecurity") return APP_SECURITY_TABS;
    if (kind === "modulesettings") return ["Configure", "Java dependencies", "Export"];
    if (kind === "security") return MODULE_SECURITY_TABS;
    return [];
  }, [kind]);
  const [active, setActive] = useState(tabs[0] ?? "");
  const title = kind === "settings" ? "App Settings" : kind === "projectsecurity" ? "App Security" :
    kind === "modulesettings" ? `${moduleName} – Module Settings` :
    kind === "security" ? `${moduleName} – Module Security` :
    kind === "navigation" ? "Navigation" : "Styling";

  return (
    <div className="modal-overlay studio-document-overlay" onMouseDown={onClose}>
      <div className="studio-document-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header><span className="studio-doc-icon">{kind.includes("security") ? "🔒" : kind === "navigation" ? "◮" : "⚙"}</span>
          <strong>{title}</strong><button onClick={onClose}>×</button></header>
        <div className={`studio-document-main${tabs.length === 0 ? " no-tabs" : ""}`}>
          {tabs.length > 0 && <nav>{tabs.map((tab) => <button key={tab}
            className={active === tab ? "selected" : ""} onClick={() => setActive(tab)}>{tab}</button>)}</nav>}
          <section>
            {kind === "settings" && <AppSettings active={active} />}
            {kind === "projectsecurity" && <AppSecurity active={active} detail={details.ProjectSecurity} modules={modules} />}
            {kind === "modulesettings" && <ModuleSettings moduleName={moduleName} active={active} />}
            {kind === "security" && <ModuleSecurity active={active} module={module} />}
            {kind === "navigation" && <NavigationEditor />}
            {kind === "styling" && <StylingEditor />}
          </section>
        </div>
        <footer><span className="studio-dialog-note">Changes are staged until applied to the project.</span>
          <button onClick={onClose}>Cancel</button><button className="primary" onClick={onClose}>OK</button></footer>
      </div>
    </div>
  );
}
