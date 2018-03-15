import { HandlerContext, logger, Success } from "@atomist/automation-client";
import { HandlerResult} from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { GitCommandGitProject } from "@atomist/automation-client/project/git/GitCommandGitProject";
import { PushTestInvocation } from "../../../../common/listener/GoalSetter";
import { addressChannelsFor } from "../../../../common/slack/addressChannels";
import { OnAnyPendingStatus } from "../../../../typings/types";
import { ConditionalBuilder } from "../ExecuteGoalOnPendingStatus";
import { ExecuteGoalInvocation } from "../ExecuteGoalOnSuccessStatus";

export function executeBuild(...conditionalBuilders: ConditionalBuilder[]) {

    return async (status: OnAnyPendingStatus.Status, context: HandlerContext, params: ExecuteGoalInvocation) => {
        const commit = status.commit;
        await dedup(commit.sha, async () => {
            const credentials = {token: params.githubToken};
            const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);
            const team = commit.repo.org.chatTeam.id;

            const project = await GitCommandGitProject.cloned({ credentials, context, id});
            const i: PushTestInvocation = {
                id,
                project,
                credentials,
                context,
                addressChannels: addressChannelsFor(commit.repo, context),
                // TODO flesh this out properly
                push: {
                    id: null,
                    branch: status.commit.pushes[0].branch,
                    before: {
                        sha: null,
                        message: null,
                        committer: {
                            person: null,
                        },
                    },
                    after: {
                        sha: null,
                        message: null,
                        committer: {
                            person: null,
                        },
                    },
                    repo: commit.repo,
                    commits: [status.commit],
                },
            };

            const builders: boolean[] = await Promise.all(conditionalBuilders
                .map(b => b.guard(i)));
            const indx = builders.indexOf(true);
            if (indx < 0) {
                throw new Error(`Don't know how to build project ${id.owner}:${id.repo}`);
            }
            const builder = conditionalBuilders[indx].builder;
            logger.info("Building project %s:%s with builder [%s]", id.owner, id.repo, builder.name);

            const allBranchesThisCommitIsOn = commit.pushes.map(p => p.branch);
            const theDefaultBranchIfThisCommitIsOnIt = allBranchesThisCommitIsOn.find(b => b === commit.repo.defaultBranch);
            const someBranchIDoNotReallyCare = allBranchesThisCommitIsOn.find(b => true);
            const branchToMarkTheBuildWith = theDefaultBranchIfThisCommitIsOnIt || someBranchIDoNotReallyCare || "master";

            // the builder is expected to result in a complete Build event (which will update the build status)
            // and an ImageLinked event (which will update the artifact status).
            return builder.initiateBuild(credentials, id, i.addressChannels, team, {branch: branchToMarkTheBuildWith});
        });
        return Success;
    };
}

async function dedup<T>(key: string, f: () => Promise<T>): Promise<T | void> {
    if (running[key]) {
        logger.warn("This op was called twice for " + key);
        return Promise.resolve();
    }
    running[key] = true;
    const promise = f().then(t => {
        running[key] = undefined;
        return t;
    });
    return promise;
}

const running = {};
