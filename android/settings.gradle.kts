// The Android app: a thin native shell around the same web code the Mac,
// Windows and iPhone apps use. Build it with scripts/build-android.sh.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "RummiTime"
include(":app")
