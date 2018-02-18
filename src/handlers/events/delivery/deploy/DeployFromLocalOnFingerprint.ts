/**
 * Deploy a published artifact identified in an ImageLinked event.
 */

import {
    EventFired,
    EventHandler,
    GraphQL,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    logger,
    Secret,
    Secrets,
    Success,
} from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { OnDeployToProductionFingerprint } from "../../../../typings/types";
import { ArtifactStore } from "../ArtifactStore";
import {
    currentPhaseIsStillPending,
    GitHubStatusAndFriends,
    Phases,
    PlannedPhase,
    previousPhaseSucceeded,
} from "../Phases";
import { BuiltContext } from "../phases/core";
import { deploy } from "./deploy";
import { Deployer } from "./Deployer";
import { TargetInfo } from "./Deployment";

// TODO could make in common with other deployer...
@EventHandler("Deploy linked artifact",
    GraphQL.subscriptionFromFile("../../../../../../graphql/subscription/OnDeployToProductionFingerprint.graphql",
        __dirname))
export class DeployFromLocalOnFingerprint<T extends TargetInfo> implements HandleEvent<OnDeployToProductionFingerprint.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    constructor(private phases: Phases,
                private ourPhase: PlannedPhase,
                private endpointPhase: PlannedPhase,
                private artifactStore: ArtifactStore,
                private deployer: Deployer<T>,
                private targeter: (id: RemoteRepoRef) => T) {
    }

    public handle(event: EventFired<OnDeployToProductionFingerprint.Subscription>, ctx: HandlerContext, params: this): Promise<HandlerResult> {
        const fingerprint = event.data.Fingerprint[0];
        const commit = fingerprint.commit;

        // TODO doesn't work as built status isn't in, yet
        // const builtStatus = commit.statuses.find(status => status.context === BuiltContext);
        // if (!builtStatus) {
        //     console.log(`Deploy: builtStatus not found`);
        //     return Promise.resolve(Success);
        // }
        const statusAndFriends: GitHubStatusAndFriends = {
            context: BuiltContext,
            state: "success", // builtStatus.state,
            targetUrl: "xxx",
            siblings: fingerprint.commit.statuses,
        };

        if (!previousPhaseSucceeded(params.phases, params.ourPhase.context, statusAndFriends)) {
            return Promise.resolve(Success);
        }

        if (!currentPhaseIsStillPending(params.ourPhase.context, statusAndFriends)) {
            return Promise.resolve(Success);
        }

        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);
        logger.info("Fingerprint deployer deploying image [%s]", fingerprint.commit.image.imageName);
        return deploy(params.ourPhase, params.endpointPhase,
            id, params.githubToken,
            fingerprint.commit.image.imageName,
            params.artifactStore, params.deployer, params.targeter);
    }
}