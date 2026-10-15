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
        maven("https://dl.frostwire.com/maven") { content { includeGroup("com.frostwire") } }
    }
}
rootProject.name = "Tuner"
include(":app")
