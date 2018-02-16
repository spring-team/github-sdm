import { HandlerContext } from "@atomist/automation-client";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import { ScanOnPendingScanStatus } from "../../handlers/events/delivery/ScanOnPendingScanStatus";
import { clean, ProjectReview } from "@atomist/automation-client/operations/review/ReviewResult";

export const Scan = new ScanOnPendingScanStatus([scan]);

async function scan(p: GitProject,
                    ctx: HandlerContext): Promise<ProjectReview> {
    // try {
    //     await p.findFile("pom.xml");
    //     return {passed: true};
    // } catch {
    //     return {passed: false, message: "This project has no pom. Cannot deploy"};
    // }
    console.log("REVIEWING THING");
    return clean(p.id);
}
