import { JobStatus } from "./lifecycle";

export interface JobQuery {
  name?: string;
  data?: Record<string, any>;
  status?: JobStatus | JobStatus[];
  limit?: number;
  skip?: number;
  sort?: {
    field: "nextRunAt" | "createdAt" | "updatedAt";
    order: "asc" | "desc";
  };
}
