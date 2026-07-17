import { nextTick, onMounted } from 'vue';

let mineradioRuntimePromise;

export function useMineradioRuntime() {
  onMounted(async () => {
    await nextTick();
    if (!mineradioRuntimePromise) {
      mineradioRuntimePromise = import('../legacy/mineradio.js');
    }
    await mineradioRuntimePromise;
  });
}
