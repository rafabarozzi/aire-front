export const permissions = [
  "journeys:read",
  "journeys:create",
  "artifacts:read",
  "connections:read",
  "connections:manage",
  "access:manage",
  "collectors:read",
  "collectors:manage",
  "usage:read",
] as const;
export type Permission = (typeof permissions)[number];
export type Role = "admin" | "engineer" | "viewer";
export type Tier = "Gold" | "Silver" | "Bronze";
export type AnalysisStatus =
  | "AWAITING_SOURCE"
  | "UPLOADING"
  | "QUEUED"
  | "PREPARING"
  | "NARRATING"
  | "RENDERING"
  | "AWAITING_NARRATION"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED";
export type Session = {
  mode: "demo" | "live";
  authenticated: boolean;
  name?: string;
  tenant?: string;
  role?: Role;
  permissions: Permission[];
  providers: { google: boolean; microsoft: boolean };
  platformAdmin?: boolean;
  portal?: "admin" | "customer" | "legacy";
  workspace?: string;
  version?: string;
  onboardingIdentity?: {
    provider: string;
    issuer: string;
    subject: string;
    objectId?: string;
    workspace?: string;
  };
};
export type Journey = {
  sourceSubdirectory?: string;
  journeyKey?: string;
  versionCount?: number;
  reused?: boolean;
  id: string;
  name: string;
  tier: Tier;
  endpoint: string;
  repository: string;
  revision: string;
  status: AnalysisStatus;
  createdAt: string;
  services?: number;
  evidence?: number;
  gaps?: number;
  stacks: string[];
  description?: string;
  demo?: boolean;
};
export type Repository = {
  repository: string;
  branch: string;
  revision: string;
  private: boolean;
  demo?: boolean;
};
export type ConnectionsView = {
  revision: number;
  repositories: string[];
  githubConfigured: boolean;
  credential: {
    label: string;
    source: "panel" | "environment";
    updatedAt?: string;
  } | null;
  engineConfigured: boolean;
  groups: number;
};
export type JourneyInput = {
  name: string;
  tier: Tier;
  endpoint: string;
  repository: string;
  revision: string;
  sourceSubdirectory: string;
};
export type RolePolicy = Record<Role, Permission[]>;
export const defaultPolicy: RolePolicy = {
  admin: [...permissions],
  engineer: [
    "journeys:read",
    "journeys:create",
    "artifacts:read",
    "connections:read",
    "collectors:read",
  ],
  viewer: ["journeys:read", "artifacts:read"],
};
export const statusLabels: Record<AnalysisStatus, string> = {
  AWAITING_SOURCE: "Aguardando código",
  UPLOADING: "Recebendo código",
  QUEUED: "Na fila",
  PREPARING: "Mapeando",
  NARRATING: "Gerando narrativa",
  RENDERING: "Gerando artefatos",
  AWAITING_NARRATION: "Aguardando narração",
  FINALIZING: "Finalizando",
  COMPLETED: "Análise concluída",
  FAILED: "Falha na análise",
};
