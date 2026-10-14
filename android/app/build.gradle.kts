import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The version is the game's own, from package.json (3.1.0 becomes versionCode 30100).
val gameVersion: String = (JsonSlurper().parse(file("../../package.json")) as Map<*, *>)["version"] as String
val versionParts = gameVersion.split(".").map { it.toInt() }

android {
    namespace = "com.lyndasrummitummi.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.lyndasrummitummi.android"
        minSdk = 24
        targetSdk = 34
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
        versionName = gameVersion
    }

    // A release build is signed when the key is given (see docs/android.md);
    // otherwise the debug key signs it, which is fine for installing by hand.
    val keystore = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // the game's web files are served from the app's assets
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/web"))
}

val copyWeb by tasks.registering(Copy::class) {
    into(layout.buildDirectory.dir("generated/web/web"))
    from("../../index.html")
    from("../../src") { into("src") }
    from("../../vendor") { into("vendor") }
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation(platform("com.google.firebase:firebase-bom:33.1.2"))
    implementation("com.google.firebase:firebase-messaging")
}

// Push notifications need google-services.json from the Firebase console
// (docs/android.md). Without it the app still builds and plays; it just
// receives no notifications while closed.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
