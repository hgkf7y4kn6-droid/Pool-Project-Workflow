import {
  CHANGE_ORDER_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  type ChangeOrderStatus,
  type InspectionResult,
  type PaymentStatus,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from "@pool/types";
import { changeOrderStatusTone, inspectionResultTone, paymentStatusTone, projectStatusTone, taskPriorityTone, taskStatusTone } from "@pool/ui";
import { titleCase } from "@/lib/format";
import { Badge } from "./ui/badge";

export const ProjectStatusBadge = ({ status }: { status: ProjectStatus }) => <Badge label={PROJECT_STATUS_LABELS[status]} tone={projectStatusTone[status]} />;
export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => <Badge label={TASK_STATUS_LABELS[status]} tone={taskStatusTone[status]} size="sm" />;
export const PriorityBadge = ({ priority }: { priority: TaskPriority }) =>
  priority === "normal" ? null : <Badge label={titleCase(priority)} tone={taskPriorityTone[priority]} size="sm" icon={priority === "urgent" ? "flame" : undefined} />;
export const ChangeOrderBadge = ({ status }: { status: ChangeOrderStatus }) => <Badge label={CHANGE_ORDER_STATUS_LABELS[status]} tone={changeOrderStatusTone[status]} size="sm" />;
export const InspectionBadge = ({ result }: { result: InspectionResult }) => <Badge label={titleCase(result)} tone={inspectionResultTone[result]} size="sm" />;
export const PaymentBadge = ({ status }: { status: PaymentStatus }) => <Badge label={titleCase(status)} tone={paymentStatusTone[status]} size="sm" />;
