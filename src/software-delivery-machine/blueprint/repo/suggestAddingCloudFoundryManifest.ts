import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import * as slack from "@atomist/slack-messages/SlackMessages";
import { AddressChannels } from "../../../handlers/commands/editors/toclient/addressChannels";
import { AddCloudFoundryManifestEditorName } from "../../commands/editors/addCloudFoundryManifest";

export function suggestAddingCloudFoundryManifest(id: GitHubRepoRef, creds: ProjectOperationCredentials, addressChannels: AddressChannels) {
    const attachment: slack.Attachment = {
            text: "Add a Cloud Foundry manifest to your new repo?",
            fallback: "add PCF manifest",
            actions: [buttonForCommand({text: "Add Cloud Foundry Manifest"},
                AddCloudFoundryManifestEditorName,
                {"targets.owner": id.owner, "targets.repo": id.repo},
            ),
            ],
        }
    ;
    const message: slack.SlackMessage = {
        attachments: [attachment],
    };
    return addressChannels(message);
}