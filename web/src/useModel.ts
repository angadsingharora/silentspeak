import { useSyncExternalStore } from "react";
import { model, type AppModel } from "./model";

/** Subscribes the component to every model change. */
export function useModel(): AppModel {
  useSyncExternalStore(model.subscribe, () => model.version);
  return model;
}
