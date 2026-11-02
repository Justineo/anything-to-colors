import { createVaporApp } from "vue";
import App from "./App.vue";

export function mount() {
  createVaporApp(App).mount("#app");
}
