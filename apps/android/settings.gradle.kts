pluginManagement {
    repositories {
        System.getenv("MAVEN_MIRROR")?.let { maven(it) }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        System.getenv("MAVEN_MIRROR")?.let { maven(it) }
        google()
        mavenCentral()
    }
}
rootProject.name = "Tuner"
include(":app")
