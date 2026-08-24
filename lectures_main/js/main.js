/*
  ENG-654 visualization bootstrap.
  Navigation is intentionally loaded separately through js/deck/nav-runtime.js
  so slide movement still works if a visualization module fails.
*/

document.addEventListener('DOMContentLoaded', async () => {
  // Keep the visualization module graph on one revision. This prevents browsers
  // from mixing a newly edited demo with stale cached dependencies.
const revision = '20260820-62';
  const loaders = [
    async () => {
      const module = await import(`./viz/robot2r.js?v=${revision}`);
      module.initRobot2R?.();
    },
    async () => {
      const module = await import(`./viz/threeRevolute.js?v=${revision}`);
      module.initThreeRevoluteDemos?.();
    },
    async () => {
      const module = await import(`./viz/frameDHPlayground.js?v=${revision}`);
      module.initFrameDHPlaygrounds?.();
    },
    async () => {
      const module = await import(`./viz/poeUrdfPlayground.js?v=${revision}`);
      module.initPoeUrdfPlaygrounds?.();
    },
    async () => {
      const module = await import(`./viz/custom3rIk.js?v=${revision}`);
      module.initCustom3RIkDemos?.();
    },
    async () => {
      const module = await import(`./viz/custom6rIk.js?v=${revision}`);
      module.initCustom6RIkDemos?.();
    },
    async () => {
      const module = await import(`./viz/pumaIiwaIk.js?v=${revision}`);
      module.initPumaIiwaIkDemos?.();
    },
    async () => {
      const module = await import(`./viz/singularityLecture.js?v=${revision}`);
      module.initSingularityLecture?.();
    },
    async () => {
      const module = await import(`./viz/cuspidalityLecture.js?v=${revision}`);
      module.initCuspidalityLecture?.();
    },
    async () => {
      const module = await import(`./viz/pathPlanningLecture.js?v=${revision}`);
      module.initPathPlanningLecture?.();
    },
    async () => {
      const module = await import(`./viz/redundantPlanningLecture.js?v=${revision}`);
      module.initRedundantPlanningLecture?.();
    }
  ];

  for (const load of loaders) {
    try {
      await load();
    } catch (error) {
      console.error('ENG-654 visualization module failed:', error);
    }
  }
});
