/*
 * Copyright © 2018 Atomist, Inc.
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

import { EventFired, failure, HandleEvent, HandlerContext, HandlerResult, logger, Secrets, Success } from "@atomist/automation-client";
import { subscription } from "@atomist/automation-client/graph/graphQL";
import { EventHandlerMetadata } from "@atomist/automation-client/metadata/automationMetadata";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { ProjectOperationCredentials, TokenCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import * as stringify from "json-stringify-safe";
import { sdmGoalStateToGitHubStatusState } from "../../../common/delivery/goals/CopyGoalToGitHubStatus";
import { Goal } from "../../../common/delivery/goals/Goal";
import { ExecuteGoalInvocation, ExecuteGoalResult, GoalExecutor } from "../../../common/delivery/goals/goalExecution";
import { environmentFromGoal, storeGoal, updateGoal } from "../../../common/delivery/goals/storeGoals";
import { GoalState, SdmGoal } from "../../../ingesters/sdmGoalIngester";
import { CommitForSdmGoal, OnRequestedSdmGoal, SdmGoalFields, StatusForExecuteGoal, StatusState } from "../../../typings/types";
import { createStatus } from "../../../util/github/ghub";
import { executeGoal, validSubscriptionName } from "./ExecuteGoalOnSuccessStatus";
import { forApproval } from "./verify/approvalGate";

export class ExecuteGoalOnRequested implements HandleEvent<OnRequestedSdmGoal.Subscription>,
    ExecuteGoalInvocation, EventHandlerMetadata {

    public subscriptionName: string;
    public subscription: string;
    public name: string;
    public description: string;
    public secrets = [{name: "githubToken", uri: Secrets.OrgToken}];

    public githubToken: string;

    public implementationName: string;

    constructor(implementationName: string,
                public goal: Goal,
                private execute: GoalExecutor,
                private handleGoalUpdates: boolean = false) {
        this.implementationName = validSubscriptionName(implementationName);
        this.subscriptionName = this.implementationName + "OnRequested";
        this.subscription =
            subscription({
                name: "OnRequestedSdmGoal", operationName: this.subscriptionName,
                variables: {goalName: goal.name, environment: environmentFromGoal(goal)},
            });
        this.name = implementationName + "OnRequestedSdmGoal";
        this.description = `Execute ${goal.name} when requested`;
    }

    public async handle(event: EventFired<OnRequestedSdmGoal.Subscription>,
                        ctx: HandlerContext,
                        params: this): Promise<HandlerResult> {

        const sdmGoal = event.data.SdmGoal[0] as SdmGoal;
        const commit = await fetchCommitForSdmGoal(ctx, sdmGoal);

        const status: StatusForExecuteGoal.Fragment = convertForNow(sdmGoal, commit);

        // this should not happen but it could
        if (status.context !== params.goal.context || sdmGoal.state !== "requested") {
            logger.warn(`Received '${sdmGoal.state}' on ${status.context}, while looking for 'requested' on ${params.goal.context}`);
            return Success;
        }

        // TODO: this has to be a bug. it isn't getting the secret once I changed the subscription to be the SdmGoal
        params.githubToken = process.env.GITHUB_TOKEN;
        try {
            const result = await executeGoal(this.execute, status, ctx, params);
            if (params.handleGoalUpdates) {
                markStatus(ctx, sdmGoal, params.goal, result);
            }
            return Success;
        } catch (err) {
            logger.warn("Error executing %s on %s: %s", params.implementationName, repoRef(status).url, err.message);
            if (params.handleGoalUpdates) {
                await markStatus(ctx, sdmGoal, params.goal, { code: 1 });
            }
            return failure(err);
        }
    }
}

function repoRef(status: StatusForExecuteGoal.Fragment) {
    const commit = status.commit;
    return new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);
}

function markStatus(ctx: HandlerContext, sdmGoal: SdmGoal, goal: Goal, result: ExecuteGoalResult) {
    const newState = result.code !== 0 ? "failure" :
        result.requireApproval ? "waiting_for_approval" : "success";
    return updateGoal(ctx, sdmGoal as SdmGoal,
        {
            goal,
            url: result.targetUrl,
            state: newState,
        });
}

function convertForNow(sdmGoal: SdmGoalFields.Fragment, commit: CommitForSdmGoal.Commit): StatusForExecuteGoal.Fragment {
    return {
        commit,
        state: sdmGoalStateToGitHubStatusState(sdmGoal.state as GoalState),
        targetUrl: sdmGoal.url, // not handling approval weirdness
        context: sdmGoal.externalKey,
        description: sdmGoal.description,
    };
}

async function fetchCommitForSdmGoal(ctx: HandlerContext, goal: SdmGoalFields.Fragment): Promise<CommitForSdmGoal.Commit> {
    const variables = {sha: goal.sha, repo: goal.repo.name, owner: goal.repo.owner, branch: goal.branch};
    const result = await ctx.graphClient.query<CommitForSdmGoal.Query, CommitForSdmGoal.Variables>(
        {name: "CommitForSdmGoal", variables: {sha: goal.sha, repo: goal.repo.name, owner: goal.repo.owner, branch: goal.branch}});
    if (!result || !result.Commit || result.Commit.length === 0) {
        throw new Error("No commit found for goal " + stringify(variables));
    }
    return result.Commit[0];
}
