# frozen_string_literal: true

require_relative "../lib/mendix_bridge"

model = MendixBridge.app("Customer Portal", version: "1.0") do
  modulo "CRM" do
    entity "Customer" do
      attribute "Name", :string, required: true
      attribute "Active", :boolean, default: true
    end
  end

  modulo "Sales" do
    entity "Order" do
      attribute "Number", :string, required: true
      attribute "Total", :decimal, default: 0

      association "Order_Customer",
        target: "CRM.Customer",
        cardinality: :one
    end
  end
end

puts JSON.pretty_generate(model.to_h) if $PROGRAM_NAME == __FILE__

model
