export type FlowAvailability = "both" | "microflow" | "nanoflow";

export interface FlowActivitySpec {
  id: string;
  label: string;
  icon: string;
  group: string;
  availability: FlowAvailability;
  writable?: boolean;
}

const both = (group: string, id: string, label: string, icon: string, writable = false): FlowActivitySpec =>
  ({ group, id, label, icon, availability: "both", writable });
const micro = (group: string, id: string, label: string, icon: string, writable = false): FlowActivitySpec =>
  ({ group, id, label, icon, availability: "microflow", writable });
const nano = (group: string, id: string, label: string, icon: string, writable = false): FlowActivitySpec =>
  ({ group, id, label, icon, availability: "nanoflow", writable });

// Mendix Studio Pro 11 activity catalog, grouped as it appears in the Toolbox.
// `writable` means the current mxcli MDL grammar can round-trip the activity.
export const FLOW_ACTIVITIES: FlowActivitySpec[] = [
  both("Object activities", "cast", "Cast object", "⬇"),
  both("Object activities", "changeObject", "Change object", "✎", true),
  both("Object activities", "commit", "Commit object(s)", "✔", true),
  both("Object activities", "create", "Create object", "＋", true),
  both("Object activities", "delete", "Delete object(s)", "🗑", true),
  both("Object activities", "retrieve", "Retrieve object(s)", "⤵", true),
  both("Object activities", "rollback", "Rollback object", "↺", true),

  both("List activities", "aggregate", "Aggregate list", "Σ", true),
  both("List activities", "changeList", "Change list", "⇄", true),
  both("List activities", "createList", "Create list", "＋", true),
  both("List activities", "listOperation", "List operation", "≣", true),

  micro("Call activities", "java", "Call Java action", "☕", true),
  nano("Call activities", "javascript", "Call JavaScript action", "𝒋", true),
  both("Call activities", "microflow", "Call microflow", "⚙", true),

  both("Variable activities", "assign", "Change variable", "✎", true),
  both("Variable activities", "createVariable", "Create variable", "＋", true),

  nano("Client activities", "nanoflow", "Call nanoflow", "⚡", true),
  both("Client activities", "closePage", "Close page", "×", true),
  micro("Client activities", "download", "Download file", "↧"),
  micro("Client activities", "showHomePage", "Show home page", "⌂"),
  both("Client activities", "showMessage", "Show message", "⚑"),
  both("Client activities", "showPage", "Show page", "▤", true),
  micro("Client activities", "synchronizeToDevice", "Synchronize to device", "⇅"),
  nano("Client activities", "synchronize", "Synchronize", "⇅"),
  both("Client activities", "validation", "Validation feedback", "✔", true),

  micro("Integration activities", "externalAction", "Call external action", "⇥"),
  micro("Integration activities", "rest", "Call REST service", "⇄"),
  micro("Integration activities", "webservice", "Call web service", "☁"),
  micro("Integration activities", "importMapping", "Import with mapping", "⇣"),
  micro("Integration activities", "exportMapping", "Export with mapping", "⇡"),
  micro("Integration activities", "externalDatabase", "Query external database", "▦"),
  micro("Integration activities", "sendRestRequest", "Send REST request", "➤"),

  both("Logging activities", "log", "Log message", "▤", true),
  micro("Document generation (deprecated)", "generateDocument", "Generate document", "▧"),
  micro("Metrics activities", "counter", "Counter", "＋"),
  micro("Metrics activities", "incrementCounter", "Increment counter", "↑"),
  micro("Metrics activities", "gauge", "Gauge", "◒"),
  micro("Email activities", "email", "Send email", "✉"),
  micro("ML Kit activities", "mlModel", "Call ML model", "⌁"),

  micro("Workflow activities", "applyJump", "Apply jump-to option", "↪"),
  micro("Workflow activities", "callWorkflow", "Call workflow", "▶"),
  micro("Workflow activities", "changeWorkflowState", "Change workflow state", "◫"),
  micro("Workflow activities", "completeUserTask", "Complete user task", "✓"),
  micro("Workflow activities", "generateJumpOptions", "Generate jump-to options", "⇥"),
  micro("Workflow activities", "retrieveActivityRecords", "Retrieve workflow activity records", "≣"),
  micro("Workflow activities", "retrieveWorkflowContext", "Retrieve workflow context", "⤵"),
  micro("Workflow activities", "retrieveWorkflows", "Retrieve workflows", "⤵"),
  micro("Workflow activities", "showUserTaskPage", "Show user task page", "▤"),
  micro("Workflow activities", "showWorkflowAdmin", "Show workflow admin page", "▤"),
  micro("Workflow activities", "lockWorkflow", "Lock workflow", "🔒"),
  micro("Workflow activities", "unlockWorkflow", "Unlock workflow", "🔓"),
  micro("Workflow activities", "notifyWorkflow", "Notify workflow", "◉"),

  micro("External object activities", "deleteExternalObject", "Delete external object", "🗑"),
  micro("External object activities", "sendExternalObject", "Send external object", "➤"),
];

export function activitiesFor(flowType?: string): FlowActivitySpec[] {
  return FLOW_ACTIVITIES.filter((activity) =>
    activity.availability === "both" || activity.availability === flowType,
  );
}

export function activitySpec(id?: string): FlowActivitySpec | undefined {
  return FLOW_ACTIVITIES.find((activity) => activity.id === id);
}
