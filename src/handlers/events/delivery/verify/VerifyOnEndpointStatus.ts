/*
 * Copyright © 2017 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {GraphQL, HandlerResult, logger, Secret, Secrets, success, Success} from "@atomist/automation-client";
import {EventFired, EventHandler, HandleEvent, HandlerContext} from "@atomist/automation-client/Handlers";
import {GitHubRepoRef} from "@atomist/automation-client/operations/common/GitHubRepoRef";
import {OnSuccessStatus, StatusState} from "../../../../typings/types";
import {createStatus} from "../../../commands/editors/toclient/ghub";
import {currentPhaseIsStillPending, previousPhaseSucceeded} from "../Phases";
import {ContextToPlannedPhase, HttpServicePhases, StagingEndpointContext, StagingVerifiedContext} from "../phases/httpServicePhases";

export type EndpointVerifier = (url: string) => Promise<any>;

/**
 * Deploy a published artifact identified in a GitHub "artifact" status.
 */
@EventHandler("Check endpoint",
    GraphQL.subscriptionFromFile("../../../../../../graphql/subscription/OnSuccessStatus.graphql",
        __dirname, {
            context: StagingEndpointContext,
        }))
export class VerifyOnEndpointStatus implements HandleEvent<OnSuccessStatus.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    constructor(private verifier: EndpointVerifier) {
    }

    public handle(event: EventFired<OnSuccessStatus.Subscription>, ctx: HandlerContext, params: this): Promise<HandlerResult> {
        const status = event.data.Status[0];
        const commit = status.commit;

        const statusAndFriends = {context: status.context, state: status.state, targetUrl: status.targetUrl, siblings: status.commit.statuses};

        if (!previousPhaseSucceeded(HttpServicePhases, StagingVerifiedContext, statusAndFriends)) {
            return Promise.resolve(Success);
        }

        if (!currentPhaseIsStillPending(StagingVerifiedContext, statusAndFriends)) {
            return Promise.resolve(Success);
        }

        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);

        return params.verifier(status.targetUrl)
            .then(() => setVerificationStatus(params.githubToken, id, "success", status.targetUrl)
                .then(success))
            .catch(err => {
                // todo: report error in Slack? ... or load it to a log that links
                logger.warn("Failing verification because: " + err);
                return setVerificationStatus(params.githubToken, id, "failure", status.targetUrl)
                    .then(success);
            });
    }
}

function setVerificationStatus(token: string, id: GitHubRepoRef, state: StatusState, targetUrl: string): Promise<any> {
    return createStatus(token, id, {
        state,
        target_url: targetUrl,
        context: StagingVerifiedContext,
        description: `${state === "success" ? "Completed" : "Failed to "} ${ContextToPlannedPhase[StagingVerifiedContext].name}`,
    });
}