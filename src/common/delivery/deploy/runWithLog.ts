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

import { failure, HandlerContext, logger, Success } from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import { retryCommandNameFor } from "../../../handlers/commands/triggerGoal";
import { ArtifactStore } from "../../../spi/artifact/ArtifactStore";
import { Deployer } from "../../../spi/deploy/Deployer";
import { TargetInfo } from "../../../spi/deploy/Deployment";
import { LogInterpreter } from "../../../spi/log/InterpretedLog";
import { ProgressLog } from "../../../spi/log/ProgressLog";
import { OnAnySuccessStatus, StatusForExecuteGoal } from "../../../typings/types";
import { createStatus } from "../../../util/github/ghub";
import { reportFailureInterpretation } from "../../../util/slack/reportFailureInterpretation";
import { SdmContext } from "../../context/SdmContext";
import { createEphemeralProgressLog } from "../../log/EphemeralProgressLog";
import { ConsoleProgressLog, InMemoryProgressLog, MultiProgressLog } from "../../log/progressLogs";
import { AddressChannels, addressChannelsFor } from "../../slack/addressChannels";
import { Goal } from "../goals/Goal";
import { ExecuteGoalInvocation, ExecuteGoalResult, GoalExecutor } from "../goals/goalExecution";
import { deploy, Targeter } from "./deploy";

export interface DeploySpec<T extends TargetInfo> {
    implementationName: string;
    deployGoal: Goal;
    endpointGoal: Goal;
    artifactStore?: ArtifactStore;
    deployer: Deployer<T>;
    targeter: Targeter<T>;
    undeploy?: {
        goal: Goal;
        implementationName: string;
    };
    undeployOnSuperseded?: boolean;
}

export function runWithLog(whatToRun: (RunWithLogInvocation) => Promise<ExecuteGoalResult>,
                           logInterpreter?: LogInterpreter): GoalExecutor {
    return async (status: OnAnySuccessStatus.Status, ctx: HandlerContext, params: ExecuteGoalInvocation) => {
        const commit = status.commit;
        const log = await createEphemeralProgressLog();
        const progressLog = new MultiProgressLog(new ConsoleProgressLog(), new InMemoryProgressLog(), log);
        const addressChannels = addressChannelsFor(commit.repo, ctx);
        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);
        const credentials = {token: params.githubToken};

        const reportError = howToReportError(params, addressChannels, progressLog, id, logInterpreter);
        await whatToRun({status, progressLog, reportError, context: ctx, addressChannels, id, credentials})
            .catch(err => reportError(err));
        await progressLog.close();
        return Promise.resolve(Success as ExecuteGoalResult);
    };
}

export interface RunWithLogContext extends SdmContext {
    status: StatusForExecuteGoal.Fragment;
    progressLog: ProgressLog;
    reportError: (Error) => Promise<ExecuteGoalResult>;
}

export type ExecuteWithLog = (rwlc: RunWithLogContext) => Promise<ExecuteGoalResult>;

function howToReportError(executeGoalInvocation: ExecuteGoalInvocation,
                          addressChannels: AddressChannels,
                          progressLog: ProgressLog,
                          id: GitHubRepoRef,
                          logInterpreter?: LogInterpreter) {
    return async (err: Error) => {
        logger.error(err.message);
        logger.error(err.stack);
        progressLog.write("ERROR: " + err.message);
        progressLog.write(err.stack);
        progressLog.write("full error object: [%j]" + err);

        const retryButton = buttonForCommand({text: "Retry"},
            retryCommandNameFor(executeGoalInvocation.implementationName), {
                repo: id.repo,
                owner: id.owner,
                sha: id.sha,
            });

        const interpretation = logInterpreter && !!progressLog.log && logInterpreter(progressLog.log);
        // The deployer might have information about the failure; report it in the channels
        if (interpretation) {
            await reportFailureInterpretation("deploy", interpretation,
                {url: progressLog.url, log: progressLog.log},
                id, addressChannels, retryButton);
        } else {
            await addressChannels(":x: Failure deploying: " + err.message);
        }
        return createStatus(executeGoalInvocation.githubToken, id, {
            state: "failure",
            target_url: progressLog.url,
            context: executeGoalInvocation.goal.context,
            description: executeGoalInvocation.goal.failureDescription,
        }).then(no => ({code: 0, message: err.message}));
    };
}
