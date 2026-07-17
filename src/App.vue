<template>
  <div id="desktop-window-shell">
    <DesktopChrome />
    <SplashSearch />
    <HomeDashboard />
    <TopActions />
    <VisualControls />
    <LibraryPanel />
    <StageHud />
    <PlayerControls />
    <NativeInputs />
    <AppModals />
    <NotificationsGuide />
  </div>
</template>

<script setup>
import DesktopChrome from './components/mineradio/DesktopChrome';
import SplashSearch from './components/mineradio/SplashSearch';
import HomeDashboard from './components/mineradio/HomeDashboard';
import TopActions from './components/mineradio/TopActions';
import VisualControls from './components/mineradio/VisualControls';
import LibraryPanel from './components/mineradio/LibraryPanel';
import StageHud from './components/mineradio/StageHud';
import PlayerControls from './components/mineradio/PlayerControls';
import NativeInputs from './components/mineradio/NativeInputs';
import AppModals from './components/mineradio/AppModals';
import NotificationsGuide from './components/mineradio/NotificationsGuide';
import { useMineradioRuntime } from './composables/useMineradioRuntime.js';

useMineradioRuntime();
</script>
