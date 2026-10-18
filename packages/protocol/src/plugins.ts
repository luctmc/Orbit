/** Orbit application plugins v1 EXPERIMENTAL. Not the Orca API or native CLI plugins. */
export const APP_PLUGIN_EVENTS=['mission.status.changed','pane.status.changed'] as const
export type AppPluginEventName=typeof APP_PLUGIN_EVENTS[number]
export const APP_PLUGIN_PERMISSIONS=['panels','commands','events:mission.status.changed','events:pane.status.changed'] as const
export type AppPluginPermission=typeof APP_PLUGIN_PERMISSIONS[number]
export interface AppPluginManifest {
 manifestVersion:1;pluginApi:1;experimental:true
 publisher:string;id:string;name:string;version:string;entry:string
 permissions:AppPluginPermission[]
 contributes:{panels:Array<{id:string;title:string}>;commands:Array<{id:string;title:string}>;events:AppPluginEventName[]}
}
export interface AppPluginSummary {key:string;hash:string;enabled:boolean;manifest:AppPluginManifest|null;error:string|null}
export interface LoadedAppPlugin {key:string;hash:string;manifest:AppPluginManifest;code:string}
/** Deliberately excludes prompts, paths, accounts, credentials and usage/cost. */
export type AppPluginEvent={name:'mission.status.changed';missionId:string;status:string}|{name:'pane.status.changed';paneId:number;missionId:string;status:string}
