import type { Template } from "./engine/classifier";
import { evaluate } from "./engine/evaluation";
import type { FeatureSet } from "./engine/motion";

export interface EvaluationRequest {
  templates: Template[];
  featureSet: FeatureSet;
  k: number;
  permutations: number;
}

self.onmessage = (event: MessageEvent<EvaluationRequest>) => {
  const { templates, featureSet, k, permutations } = event.data;
  const result = evaluate(templates, {
    featureSet,
    k,
    permutations,
    onProgress: (fraction) => self.postMessage({ type: "progress", fraction }),
  });
  self.postMessage({ type: "result", result });
};
