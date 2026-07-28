# frozen_string_literal: true

module MendixBridge
  # Builds ALTER PAGE / ALTER SNIPPET MDL statements from a structured list of
  # operations.  Each operation is a Hash with an "op" key and operation-
  # specific fields:
  #
  #   { "op" => "set",          "widget" => "btnSave",
  #     "props" => { "Caption" => "Save & Close", "ButtonStyle" => "Success" } }
  #
  #   { "op" => "insert_after", "widget" => "tbEmail",
  #     "body" => "textbox tbPhone (Label: 'Phone', Attribute: Phone)" }
  #
  #   { "op" => "insert_before","widget" => "btnCancel",
  #     "body" => "actionbutton btnBack (Caption: 'Back', Action: close_page)" }
  #
  #   { "op" => "drop",         "widgets" => ["tbUnused", "lblOld"] }
  #
  #   { "op" => "replace",      "widget" => "tbName",
  #     "body" => "textarea taName (Label: 'Name', Attribute: Name)" }
  #
  #   { "op" => "set_layout",   "layout" => "Atlas_Core.Atlas_Sidebar_Full" }
  #
  #   { "op" => "add_variable", "name" => "counter",
  #     "type" => "Integer",    "default" => "0" }
  #
  #   { "op" => "drop_variable","name" => "counter" }
  #
  # Validation errors are returned as an array of strings from `validate`.
  # `build` raises `ArgumentError` when there are errors.
  module AlterPageBuilder
    VALID_OPS = %w[
      set insert_after insert_before drop replace set_layout add_variable drop_variable
    ].freeze

    IDENTIFIER = /\A[A-Za-z_]\w*\z/
    QN_PATTERN = /\A[A-Za-z_]\w*\.[A-Za-z_]\w*\z/
    LAYOUT_QN  = /\A[A-Za-z_]\w*\.[A-Za-z_]\w*\z/

    # Build an ALTER PAGE MDL string from `qn` and an array of `operations`.
    # Raises ArgumentError if any operation is invalid.
    # Pass `known_names:` (array of widget name strings from the page tree) to
    # enable widget-name existence checks.  Omit it to skip those checks.
    def self.build(qn:, operations:, known_names: nil)
      errors = validate(operations, known_names: known_names)
      raise ArgumentError, errors.join("; ") if errors.any?

      lines = operations.map { |op| build_operation(op) }.compact
      "ALTER PAGE #{qn} {\n#{lines.join("\n")}\n};\n"
    end

    # Returns an array of human-readable error strings, or [] if valid.
    def self.validate(operations, known_names: nil)
      return ["operations must be an array"] unless operations.is_a?(Array)

      errors = []
      operations.each_with_index do |op, i|
        prefix = "operation[#{i}]"
        unless op.is_a?(Hash)
          errors << "#{prefix}: must be a hash"
          next
        end

        kind = op["op"].to_s
        unless VALID_OPS.include?(kind)
          errors << "#{prefix}: unknown op '#{kind}' (valid: #{VALID_OPS.join(", ")})"
          next
        end

        case kind
        when "set"
          errors << "#{prefix}: 'widget' required" unless op["widget"].is_a?(String)
          errors << "#{prefix}: 'props' must be a non-empty hash" unless
            op["props"].is_a?(Hash) && op["props"].any?
          check_widget_exists(prefix, op["widget"], known_names, errors)

        when "insert_after", "insert_before"
          errors << "#{prefix}: 'widget' required" unless op["widget"].is_a?(String)
          errors << "#{prefix}: 'body' required (MDL widget definition)" unless
            op["body"].is_a?(String) && !op["body"].strip.empty?
          check_widget_exists(prefix, op["widget"], known_names, errors)

        when "drop"
          unless op["widgets"].is_a?(Array) && op["widgets"].all? { |w| w.is_a?(String) }
            errors << "#{prefix}: 'widgets' must be an array of strings"
            next
          end
          op["widgets"].each { |w| check_widget_exists(prefix, w, known_names, errors) }

        when "replace"
          errors << "#{prefix}: 'widget' required" unless op["widget"].is_a?(String)
          errors << "#{prefix}: 'body' required (MDL widget definition)" unless
            op["body"].is_a?(String) && !op["body"].strip.empty?
          check_widget_exists(prefix, op["widget"], known_names, errors)

        when "set_layout"
          unless op["layout"].is_a?(String) && op["layout"].match?(LAYOUT_QN)
            errors << "#{prefix}: 'layout' must be a qualified name (Module.Layout)"
          end

        when "add_variable"
          errors << "#{prefix}: 'name' must be a valid identifier" unless
            op["name"].is_a?(String) && op["name"].match?(IDENTIFIER)
          errors << "#{prefix}: 'type' required" unless op["type"].is_a?(String)

        when "drop_variable"
          errors << "#{prefix}: 'name' must be a valid identifier" unless
            op["name"].is_a?(String) && op["name"].match?(IDENTIFIER)
        end
      end

      errors
    end

    # -------------------------------------------------------------------------
    private_class_method def self.check_widget_exists(prefix, name, known_names, errors)
      return unless known_names && name.is_a?(String)

      unless known_names.include?(name)
        errors << "#{prefix}: widget '#{name}' not found in page (known: #{known_names.sort.join(", ")})"
      end
    end

    private_class_method def self.build_operation(op)
      case op["op"]
      when "set"
        props = render_props(op["props"])
        "  SET (#{props}) ON #{op["widget"]};"

      when "insert_after"
        "  INSERT AFTER #{op["widget"]} {\n#{indent_body(op["body"])}\n  };"

      when "insert_before"
        "  INSERT BEFORE #{op["widget"]} {\n#{indent_body(op["body"])}\n  };"

      when "drop"
        names = Array(op["widgets"]).join(", ")
        "  DROP WIDGET #{names};"

      when "replace"
        "  REPLACE #{op["widget"]} WITH {\n#{indent_body(op["body"])}\n  };"

      when "set_layout"
        "  SET Layout #{op["layout"]};"

      when "add_variable"
        default = op["default"] ? " = '#{escape_mdl(op["default"].to_s)}'" : ""
        "  ADD VARIABLES $#{op["name"]}: #{op["type"]}#{default};"

      when "drop_variable"
        "  DROP VARIABLES $#{op["name"]};"
      end
    end

    private_class_method def self.render_props(props)
      props.map do |key, value|
        rendered =
          case value
          when String  then value.match?(/\A[A-Za-z_$][\w.$\/]*\z/) ? value : "'#{escape_mdl(value)}'"
          when Integer, Float then value.to_s
          when TrueClass, FalseClass then value.to_s
          else "'#{escape_mdl(value.to_s)}'"
          end
        "#{key}: #{rendered}"
      end.join(", ")
    end

    private_class_method def self.indent_body(body)
      body.to_s.strip.lines.map { |line| "    #{line.rstrip}" }.join("\n")
    end

    private_class_method def self.escape_mdl(str)
      str.to_s.gsub("'", "''")
    end
  end
end
