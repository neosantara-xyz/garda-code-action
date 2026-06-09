const NUM_DESCRIPTION_WORDS = 5;

function extractDescription(
  title: string,
  numWords = NUM_DESCRIPTION_WORDS,
): string {
  if (!title || title.trim() === "") return "task";
  return (
    title
      .trim()
      .split(/\s+/)
      .slice(0, numWords)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "task"
  );
}

export type BranchTemplateVariables = {
  prefix: string;
  entityType: string;
  entityNumber: number;
  timestamp: string;
  sha?: string;
  label?: string;
  description?: string;
};

export function applyBranchTemplate(
  template: string,
  variables: BranchTemplateVariables,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value ? String(value) : "");
  }
  return result;
}

export function generateBranchName(params: {
  template?: string;
  branchPrefix: string;
  entityType: string;
  entityNumber: number;
  sha?: string;
  label?: string;
  title?: string;
}): string {
  const now = new Date();
  const variables: BranchTemplateVariables = {
    prefix: params.branchPrefix,
    entityType: params.entityType,
    entityNumber: params.entityNumber,
    timestamp: `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`,
    sha: params.sha?.slice(0, 8),
    label: params.label || params.entityType,
    description: extractDescription(params.title || ""),
  };

  const candidate = params.template?.trim()
    ? applyBranchTemplate(params.template, variables)
    : `${params.branchPrefix}${params.entityType}-${params.entityNumber}-${variables.description}-${variables.timestamp}`;
  return (
    candidate
      .toLowerCase()
      .replace(/[^a-z0-9/_.#+,-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 90)
      .replace(/[-/.]+$/g, "") ||
    `${params.branchPrefix}${params.entityType}-${params.entityNumber}`
  );
}
