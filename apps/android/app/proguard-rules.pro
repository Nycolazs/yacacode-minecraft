# Keep Kotlinx Serialization models
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.yacacode.minecraft.**$$serializer { *; }
-keepclassmembers class com.yacacode.minecraft.** { *** Companion; }
-keepclasseswithmembers class com.yacacode.minecraft.** { kotlinx.serialization.KSerializer serializer(...); }
