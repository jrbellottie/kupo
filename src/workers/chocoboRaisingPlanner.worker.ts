import { planRaisingGoal, type RaisingGoalInput } from "../utils/chocoboRaisingPlanner";

export type RaisingPlannerResponse =
  | { status: "success"; plan: ReturnType<typeof planRaisingGoal> }
  | { status: "error"; message: string };

self.onmessage = (event: MessageEvent<RaisingGoalInput>) => {
  let response: RaisingPlannerResponse;
  try {
    response = { status: "success", plan: planRaisingGoal(event.data) };
  } catch (error) {
    response = { status: "error", message: error instanceof Error ? error.message : "An unexpected calculation error occurred." };
  }
  self.postMessage(response);
};
