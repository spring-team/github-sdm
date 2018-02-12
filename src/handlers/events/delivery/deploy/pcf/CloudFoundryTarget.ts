
import { TargetInfo } from "../../Deployment";

export interface CloudFoundryInfo extends TargetInfo {

    api: string;
    username: string;
    password: string;
    space: string;
    org: string;

}

export const PivotalWebServices = { // : Partial<CloudFoundryInfo> = {

    api: "https://api.run.pivotal.io",
};

export class EnvironmentCloudFoundryTarget implements CloudFoundryInfo {

    public api = process.env.PCF_API || PivotalWebServices.api;

    public username = process.env.PIVOTAL_USER;

    public password = process.env.PIVOTAL_PASSWORD;

    public space = process.env.PCF_SPACE;

    public org = process.env.PCF_ORG;

    get name() {
        return `PCF`;
    }

    get description() {
        return `PCF ${this.api};org=${this.org};space=${this.space};user=${this.username}`;
    }
}