<template>
  <div id="app">
    <Toast />
    <ConfirmDialog />
    <router-view />
  </div>
</template>

<script setup lang="ts">
</script>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: var(--p-font-family);
}
</style>
