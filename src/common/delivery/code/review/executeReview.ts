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

import * as _ from "lodash";

import { failure, HandlerContext, Success } from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { ProjectReview, ReviewComment } from "@atomist/automation-client/operations/review/ReviewResult";
import { GitCommandGitProject } from "@atomist/automation-client/project/git/GitCommandGitProject";
import { buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import { deepLink } from "@atomist/automation-client/util/gitHub";
import * as slack from "@atomist/slack-messages";
import { Attachment, SlackMessage } from "@atomist/slack-messages";
import { StatusForExecuteGoal } from "../../../../typings/types";
import { ProjectListenerInvocation } from "../../../listener/Listener";
import { AddressChannels, addressChannelsFor } from "../../../slack/addressChannels";
import { ExecuteGoalInvocation, GoalExecutor } from "../../goals/goalExecution";
import { relevantCodeActions, ReviewerRegistration } from "../codeActionRegistrations";
import { formatReviewerError, ReviewerError } from "./ReviewerError";

export function executeReview(reviewerRegistrations: ReviewerRegistration[]): GoalExecutor {
    return async (status: StatusForExecuteGoal.Fragment, ctx: HandlerContext, params: ExecuteGoalInvocation) => {
        const commit = status.commit;
        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);
        const credentials = {token: params.githubToken};
        const addressChannels = addressChannelsFor(commit.repo, ctx);

        try {
            if (reviewerRegistrations.length > 0) {
                const project = await GitCommandGitProject.cloned(credentials, id);
                const pti: ProjectListenerInvocation = {
                    id,
                    project,
                    credentials,
                    context: ctx,
                    addressChannels: addressChannelsFor(commit.repo, ctx),
                    push: commit.pushes[0],
                };
                const relevantReviewers = await relevantCodeActions(reviewerRegistrations, pti);
                const reviewsAndErrors: Array<{ review?: ProjectReview, error?: ReviewerError }> =
                    await Promise.all(relevantReviewers
                    .map(reviewer =>
                        reviewer.action(project, ctx, params as any)
                            .then(rvw => ({review: rvw}),
                                error => ({error}))));
                const reviews = reviewsAndErrors.filter(r => !!r.review).map(r => r.review);
                const reviewerErrors = reviewsAndErrors.filter(e => !!e.error).map(e => e.error);

                const review = consolidate(reviews);

                if (review.comments.length === 0 && reviewerErrors.length === 0) {
                    return { code: 0, requireApproval: false };
                } else {
                    // TODO might want to raise issue
                    // Fail it??
                    await sendReviewToSlack("Review comments", review, ctx, addressChannels);
                    await sendErrorsToSlack(reviewerErrors, addressChannels);
                    return { code: 0, requireApproval: true };
                }
            } else {
                // No reviewers
                return { code: 0, requireApproval: false };
            }
        } catch (err) {
            return failure(err);
        }
    };
}

function consolidate(reviews: ProjectReview[]): ProjectReview {
    // TODO check they are all the same id and that there's more than one
    return {
        repoId: reviews[0].repoId,
        comments: _.flatten(reviews.map(review => review.comments)),
    };
}

async function sendReviewToSlack(title: string,
                                 pr: ProjectReview,
                                 ctx: HandlerContext,
                                 addressChannels: AddressChannels) {
    const mesg: SlackMessage = {
        text: `*${title} on ${pr.repoId.owner}/${pr.repoId.repo}*`,
        attachments: pr.comments.map(c => reviewCommentToAttachment(pr.repoId as GitHubRepoRef, c)),
    };
    await addressChannels(mesg);
    return Success;
}

function sendErrorsToSlack(errors: ReviewerError[], addressChannels: AddressChannels) {
    errors.forEach(async e => {
        await addressChannels(formatReviewerError(e));
    });
}

function reviewCommentToAttachment(grr: GitHubRepoRef, rc: ReviewComment): Attachment {
    return {
        color: "#ff0000",
        author_name: rc.category,
        author_icon: "https://image.shutterstock.com/z/stock-vector-an-image-of-a-red-grunge-x-572409526.jpg",
        text: `${slack.url(deepLink(grr, rc.sourceLocation), "jump to")} ${rc.detail}`,
        mrkdwn_in: ["text"],
        fallback: "error",
        actions: !!rc.fix ? [
            buttonForCommand({text: "Fix"}, rc.fix.command, rc.fix.params),
        ] : [],
    };
}
