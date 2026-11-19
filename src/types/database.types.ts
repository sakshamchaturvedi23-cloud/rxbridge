export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      medicines: {
        Row: {
          brand_name: string
          composition_display: string
          composition_key: string
          created_at: string | null
          id: string
          is_jan_aushadhi: boolean
          is_nti: boolean
          is_schedule_h: boolean
          manually_verified: boolean
          manufacturer: string | null
          mrp: number
          pack_size: string | null
        }
        Insert: {
          brand_name: string
          composition_display: string
          composition_key: string
          created_at?: string | null
          id?: string
          is_jan_aushadhi?: boolean
          is_nti?: boolean
          is_schedule_h?: boolean
          manually_verified?: boolean
          manufacturer?: string | null
          mrp: number
          pack_size?: string | null
        }
        Update: {
          brand_name?: string
          composition_display?: string
          composition_key?: string
          created_at?: string | null
          id?: string
          is_jan_aushadhi?: boolean
          is_nti?: boolean
          is_schedule_h?: boolean
          manually_verified?: boolean
          manufacturer?: string | null
          mrp?: number
          pack_size?: string | null
        }
        Relationships: []
      }
      ocr_aliases: {
        Row: {
          correction_count: number
          id: string
          matched_medicine_id: string
          raw_text: string
          updated_at: string | null
        }
        Insert: {
          correction_count?: number
          id?: string
          matched_medicine_id: string
          raw_text: string
          updated_at?: string | null
        }
        Update: {
          correction_count?: number
          id?: string
          matched_medicine_id?: string
          raw_text?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocr_aliases_matched_medicine_id_fkey"
            columns: ["matched_medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_reports: {
        Row: {
          confirmed_by_patient: boolean
          created_at: string | null
          file_url: string
          id: string
          patient_id: string
          report_date: string | null
          report_type: string
          summary: string | null
          trust_label: string
        }
        Insert: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          file_url: string
          id?: string
          patient_id: string
          report_date?: string | null
          report_type: string
          summary?: string | null
          trust_label?: string
        }
        Update: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          file_url?: string
          id?: string
          patient_id?: string
          report_date?: string | null
          report_type?: string
          summary?: string | null
          trust_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          confirmed_by_patient: boolean
          created_at: string | null
          extracted_items: Json
          id: string
          image_hash: string | null
          image_url: string
          patient_id: string
          trust_checks: Json
        }
        Insert: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          extracted_items?: Json
          id?: string
          image_hash?: string | null
          image_url: string
          patient_id: string
          trust_checks?: Json
        }
        Update: {
          confirmed_by_patient?: boolean
          created_at?: string | null
          extracted_items?: Json
          id?: string
          image_hash?: string | null
          image_url?: string
          patient_id?: string
          trust_checks?: Json
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          allergies: string[] | null
          assigned_shop_id: string | null
          blood_group: string | null
          chronic_conditions: string[] | null
          created_at: string | null
          current_meds: string[] | null
          full_name: string
          id: string
          role: string
          trust_label: string
        }
        Insert: {
          allergies?: string[] | null
          assigned_shop_id?: string | null
          blood_group?: string | null
          chronic_conditions?: string[] | null
          created_at?: string | null
          current_meds?: string[] | null
          full_name: string
          id: string
          role?: string
          trust_label?: string
        }
        Update: {
          allergies?: string[] | null
          assigned_shop_id?: string | null
          blood_group?: string | null
          chronic_conditions?: string[] | null
          created_at?: string | null
          current_meds?: string[] | null
          full_name?: string
          id?: string
          role?: string
          trust_label?: string
        }
        Relationships: []
      }
      reservation_items: {
        Row: {
          allow_alternative: boolean
          final_price: number | null
          id: string
          item_status: string
          requested_medicine_id: string
          reservation_id: string
          suggested_medicine_id: string | null
          updated_at: string | null
        }
        Insert: {
          allow_alternative?: boolean
          final_price?: number | null
          id?: string
          item_status?: string
          requested_medicine_id: string
          reservation_id: string
          suggested_medicine_id?: string | null
          updated_at?: string | null
        }
        Update: {
          allow_alternative?: boolean
          final_price?: number | null
          id?: string
          item_status?: string
          requested_medicine_id?: string
          reservation_id?: string
          suggested_medicine_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_items_requested_medicine_id_fkey"
            columns: ["requested_medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_items_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_items_suggested_medicine_id_fkey"
            columns: ["suggested_medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          created_at: string | null
          estimated_total: number
          id: string
          order_status: string
          patient_id: string
          pharmacist_note: string | null
          plan_mode: string
          prescription_id: string | null
          shop_id: string
          updated_at: string | null
          verification_status: string
        }
        Insert: {
          created_at?: string | null
          estimated_total?: number
          id?: string
          order_status?: string
          patient_id: string
          pharmacist_note?: string | null
          plan_mode: string
          prescription_id?: string | null
          shop_id: string
          updated_at?: string | null
          verification_status?: string
        }
        Update: {
          created_at?: string | null
          estimated_total?: number
          id?: string
          order_status?: string
          patient_id?: string
          pharmacist_note?: string | null
          plan_mode?: string
          prescription_id?: string | null
          shop_id?: string
          updated_at?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      share_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          patient_id: string
          scope: string
          token: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          patient_id: string
          scope: string
          token?: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          patient_id?: string
          scope?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_inventory: {
        Row: {
          discount_pct: number
          id: string
          in_stock: boolean
          medicine_id: string
          shop_id: string
          stock_source: string
          updated_at: string | null
        }
        Insert: {
          discount_pct?: number
          id?: string
          in_stock?: boolean
          medicine_id: string
          shop_id: string
          stock_source?: string
          updated_at?: string | null
        }
        Update: {
          discount_pct?: number
          id?: string
          in_stock?: boolean
          medicine_id?: string
          shop_id?: string
          stock_source?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_inventory_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_inventory_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string
          archetype: string
          confirmed_requests: number
          created_at: string | null
          default_discount_pct: number
          id: string
          lat: number
          lng: number
          name: string
          reliability_score: number
          shop_type: string
          total_requests: number
        }
        Insert: {
          address: string
          archetype: string
          confirmed_requests?: number
          created_at?: string | null
          default_discount_pct?: number
          id?: string
          lat: number
          lng: number
          name: string
          reliability_score?: number
          shop_type: string
          total_requests?: number
        }
        Update: {
          address?: string
          archetype?: string
          confirmed_requests?: number
          created_at?: string | null
          default_discount_pct?: number
          id?: string
          lat?: number
          lng?: number
          name?: string
          reliability_score?: number
          shop_type?: string
          total_requests?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_shop_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
