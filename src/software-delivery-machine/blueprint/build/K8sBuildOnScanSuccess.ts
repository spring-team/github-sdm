import { BuildOnScanSuccessStatus } from "../../../handlers/events/delivery/build/BuildOnScanSuccessStatus";
import { K8sAutomationBuilder } from "../../../handlers/events/delivery/build/k8s/K8AutomationBuilder";
import { BuildContext } from "../../../handlers/events/delivery/phases/gitHubContext";
import { HttpServicePhases } from "../../../handlers/events/delivery/phases/httpServicePhases";

export const K8sBuildOnSuccessStatus = () =>
    new BuildOnScanSuccessStatus(
        HttpServicePhases,
        BuildContext,
        new K8sAutomationBuilder());