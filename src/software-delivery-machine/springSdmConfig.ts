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

import { logger } from "@atomist/automation-client";
import { springBootTagger } from "@atomist/spring-automation/commands/tag/springTagger";
import { SoftwareDeliveryMachine } from "../blueprint/SoftwareDeliveryMachine";
import { mavenFingerprinter } from "../common/delivery/code/fingerprint/maven/mavenFingerprinter";
import {
    checkstyleReviewer,
    CheckstyleReviewerRegistration,
} from "../common/delivery/code/review/checkstyle/checkstyleReviewer";
import { LocalDeployment } from "../common/delivery/deploy/deployOnLocal";
import { tagRepo } from "../common/listener/tagRepo";
import { OnDryRunBuildComplete } from "../handlers/events/dry-run/OnDryRunBuildComplete";
import { AddAtomistTypeScriptHeader } from "./blueprint/code/autofix/addAtomistTypeScriptHeader";
import { disposeProjectHandler } from "./blueprint/deploy/dispose";
import { PostToDeploymentsChannel } from "./blueprint/deploy/postToDeploymentsChannel";
import { applyHttpServiceGoals } from "./blueprint/goal/jvmGoalManagement";
import { capitalizer } from "./blueprint/issue/capitalizer";
import { requestDescription } from "./blueprint/issue/requestDescription";
import { thankYouYouRock } from "./blueprint/issue/thankYouYouRock";
import { PublishNewRepo } from "./blueprint/repo/publishNewRepo";
import { applyApacheLicenseHeaderEditor } from "./commands/editors/license/applyHeader";
import { tryToUpgradeSpringBootVersion } from "./commands/editors/spring/tryToUpgradeSpringBootVersion";
import { springBootGenerator } from "./commands/generators/spring/springBootGenerator";

/**
 * Configuration common to Spring SDMs, wherever they deploy
 * @param {SoftwareDeliveryMachine} softwareDeliveryMachine
 * @param {{useCheckstyle: boolean}} opts
 */
export function configureSpringSdm(softwareDeliveryMachine: SoftwareDeliveryMachine, opts: { useCheckstyle: boolean }) {
    softwareDeliveryMachine
        .addNewIssueListeners(requestDescription, capitalizer)
        .addClosedIssueListeners(thankYouYouRock)
        .addEditors(
            () => tryToUpgradeSpringBootVersion,
            () => applyApacheLicenseHeaderEditor,
        )
        .addGenerators(() => springBootGenerator({
            seedOwner: "spring-team",
            seedRepo: "spring-rest-seed",
        }, []))
        .addNewRepoWithCodeActions(
            tagRepo(springBootTagger),
            PublishNewRepo)
        .addSupportingCommands(() => applyHttpServiceGoals);
    if (opts.useCheckstyle) {
        const checkStylePath = process.env.CHECKSTYLE_PATH;
        if (!!checkStylePath) {
            softwareDeliveryMachine.addReviewerRegistrations(CheckstyleReviewerRegistration);
        } else {
            logger.warn("Skipping Checkstyle; to enable it, set CHECKSTYLE_PATH env variable to the location of a downloaded checkstyle jar");
        }
    }

    softwareDeliveryMachine
    // .addCodeReactions(listChangedFiles)
        .addAutofixes(AddAtomistTypeScriptHeader)
        .addDeploymentListeners(PostToDeploymentsChannel)
        .addSupportingCommands(
            () => disposeProjectHandler,
        )
        .addSupportingEvents(OnDryRunBuildComplete)
        .addFunctionalUnits(LocalDeployment);

    softwareDeliveryMachine.addFingerprinters(mavenFingerprinter);
    // .addFingerprintDifferenceListeners(diff1)
}
